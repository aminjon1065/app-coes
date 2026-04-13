import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  Logger,
  Inject,
} from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import Redis from 'ioredis';
import { User } from '../entities/user.entity';
import { Session } from '../entities/session.entity';
import { UserRole } from '../entities/user-role.entity';
import { LoginDto } from '../dto/login.dto';
import { TotpService } from './totp.service';
import { REDIS_SESSIONS } from '../../../shared/cache/cache.module';
import { DatabaseContextService } from '../../../shared/database/database-context.service';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface JwtPayload {
  sub: string;        // userId
  tid: string;        // tenantId
  roles: string[];    // role codes
  clearance: number;
  sessionId: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly databaseContext: DatabaseContextService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly totp: TotpService,
    @Inject(REDIS_SESSIONS) private readonly redis: Redis,
  ) {}

  private get users(): Repository<User> {
    return this.databaseContext.getRepository(this.dataSource, User);
  }

  private get sessions(): Repository<Session> {
    return this.databaseContext.getRepository(this.dataSource, Session);
  }

  private get userRoles(): Repository<UserRole> {
    return this.databaseContext.getRepository(this.dataSource, UserRole);
  }

  // ── Login ──────────────────────────────────────────────────────────────────

  async login(dto: LoginDto, ip: string, userAgent: string): Promise<TokenPair> {
    const user = await this.users.findOne({
      where: { email: dto.email.toLowerCase() },
      select: { id: true, tenantId: true, passwordHash: true, status: true, mfaEnabled: true, clearance: true, attributes: true },
    });

    if (!user || !(await argon2.verify(user.passwordHash!, dto.password))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status !== 'active') {
      throw new ForbiddenException(`Account is ${user.status}`);
    }

    if (user.mfaEnabled) {
      if (!dto.totpCode) {
        throw new UnauthorizedException('MFA code required');
      }
      const secret = (user.attributes as any)?.mfa_secret as string;
      if (!secret || !this.totp.verify(secret, dto.totpCode)) {
        throw new UnauthorizedException('Invalid MFA code');
      }
    }

    // Fetch role codes for JWT payload
    const roleCodes = await this.getRoleCodes(user.id);

    // Create session
    const pair = await this.createSession(user, roleCodes, ip, userAgent);

    // Update last login
    await this.users.update(user.id, { lastLoginAt: new Date() });

    return pair;
  }

  // ── Refresh ────────────────────────────────────────────────────────────────

  async refresh(rawToken: string, ip: string, userAgent: string): Promise<TokenPair> {
    const hash = this.hashToken(rawToken);

    // Check revocation in Redis (fast path)
    const revoked = await this.redis.get(`session:revoked:${hash}`);
    if (revoked) throw new UnauthorizedException('Session revoked');

    const session = await this.sessions.findOne({
      where: { refreshHash: hash, revokedAt: null as any },
    });
    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.users.findOne({
      where: { id: session.userId },
      select: { id: true, tenantId: true, status: true, clearance: true },
    });
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('User inactive');
    }

    // Revoke old session (rotation)
    await this.sessions.update(session.id, { revokedAt: new Date() });

    const roleCodes = await this.getRoleCodes(user.id);
    return this.createSession(user, roleCodes, ip, userAgent);
  }

  // ── Logout ─────────────────────────────────────────────────────────────────

  async logout(sessionId: string): Promise<void> {
    const session = await this.sessions.findOne({ where: { id: sessionId } });
    if (!session) return;

    await this.sessions.update(sessionId, { revokedAt: new Date() });

    // Cache revocation in Redis for fast-path checks (TTL = session expiry)
    const ttl = Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000));
    if (ttl > 0) {
      await this.redis.setex(`session:revoked:${session.refreshHash}`, ttl, '1');
    }
  }

  // ── MFA enrollment ─────────────────────────────────────────────────────────

  async enrollMfa(userId: string): Promise<{ uri: string; secret: string }> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: { id: true, email: true, attributes: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const secret = this.totp.generateSecret();
    await this.users
      .createQueryBuilder()
      .update()
      .set({ attributes: () => `attributes || '{"mfa_secret": "${secret}"}'::jsonb` })
      .where('id = :id', { id: userId })
      .execute();

    const issuer = this.config.get<string>('MFA_ISSUER', 'CoESCD');
    return { secret, uri: this.totp.buildUri(secret, user.email, issuer) };
  }

  async confirmMfa(userId: string, code: string): Promise<void> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: { id: true, attributes: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const secret = (user.attributes as any)?.mfa_secret as string;
    if (!secret || !this.totp.verify(secret, code)) {
      throw new UnauthorizedException('Invalid MFA code');
    }

    await this.users.update(userId, { mfaEnabled: true });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async createSession(
    user: Pick<User, 'id' | 'tenantId' | 'clearance'>,
    roleCodes: string[],
    ip: string,
    userAgent: string,
  ): Promise<TokenPair> {
    const rawToken = randomBytes(48).toString('hex');
    const hash = this.hashToken(rawToken);
    const expiryMs = this.parseMs(this.config.get<string>('JWT_REFRESH_EXPIRY', '8h'));

    const session = this.sessions.create({
      userId: user.id,
      refreshHash: hash,
      ip,
      userAgent,
      expiresAt: new Date(Date.now() + expiryMs),
    });
    await this.sessions.save(session);

    const accessExpiry = this.config.get<string>('JWT_ACCESS_EXPIRY', '10m');
    const payload: JwtPayload = {
      sub: user.id,
      tid: user.tenantId,
      roles: roleCodes,
      clearance: user.clearance,
      sessionId: session.id,
    };

    const accessToken = this.jwt.sign(payload as any, { expiresIn: accessExpiry as any });
    return { accessToken, refreshToken: rawToken, expiresIn: this.parseMs(accessExpiry) / 1000 };
  }

  private async getRoleCodes(userId: string): Promise<string[]> {
    const userRoles = await this.userRoles.find({
      where: { userId },
      relations: ['role'],
    });
    return userRoles.map((ur) => ur.role.code);
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  private parseMs(duration: string): number {
    const units: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match) return 600_000;
    return parseInt(match[1], 10) * units[match[2]];
  }
}
