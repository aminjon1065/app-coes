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
import QRCode from 'qrcode';
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
  sub: string; // userId
  tid: string; // tenantId
  roles: string[]; // role codes
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

  async login(
    dto: LoginDto,
    ip: string,
    userAgent: string,
  ): Promise<TokenPair> {
    const user = await this.users.findOne({
      where: { email: dto.email.toLowerCase() },
      select: {
        id: true,
        tenantId: true,
        passwordHash: true,
        status: true,
        mfaEnabled: true,
        clearance: true,
        attributes: true,
      },
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
    const roleCodes = await this.getRoleCodes(user.id, user.tenantId);

    // Create session
    const pair = await this.createSession(user, roleCodes, ip, userAgent);

    // Update last login
    await this.users.update(user.id, { lastLoginAt: new Date() });

    return pair;
  }

  // ── Refresh ────────────────────────────────────────────────────────────────

  async refresh(
    rawToken: string,
    ip: string,
    userAgent: string,
  ): Promise<TokenPair> {
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

    const roleCodes = await this.getRoleCodes(user.id, user.tenantId);
    return this.createSession(user, roleCodes, ip, userAgent);
  }

  // ── Logout ─────────────────────────────────────────────────────────────────

  async logout(sessionId: string): Promise<void> {
    const session = await this.sessions.findOne({ where: { id: sessionId } });
    if (!session) return;

    await this.sessions.update(sessionId, { revokedAt: new Date() });

    // Cache revocation in Redis for fast-path checks (TTL = session expiry)
    const ttl = Math.max(
      0,
      Math.floor((session.expiresAt.getTime() - Date.now()) / 1000),
    );
    if (ttl > 0) {
      await this.redis.setex(
        `session:revoked:${session.refreshHash}`,
        ttl,
        '1',
      );
    }
  }

  // ── MFA enrollment ─────────────────────────────────────────────────────────

  async enrollMfa(
    userId: string,
  ): Promise<{ uri: string; secret: string; qrCodeDataUrl: string }> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: { id: true, email: true, attributes: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const secret = this.totp.generateSecret();
    const pendingAttributes = JSON.stringify({
      ...(user.attributes ?? {}),
      mfa_pending_secret: secret,
    });
    await this.users
      .createQueryBuilder()
      .update()
      .set({
        attributes: () => `'${pendingAttributes.replace(/'/g, "''")}'::jsonb`,
      })
      .where('id = :id', { id: userId })
      .execute();

    const issuer = this.config.get<string>('MFA_ISSUER', 'CoESCD');
    const uri = this.totp.buildUri(secret, user.email, issuer);
    const qrCodeDataUrl = await QRCode.toDataURL(uri, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 256,
    });
    return { secret, uri, qrCodeDataUrl };
  }

  async confirmMfa(userId: string, code: string): Promise<void> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: { id: true, attributes: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const secret = (user.attributes as any)?.mfa_pending_secret as string;
    if (!secret || !this.totp.verify(secret, code)) {
      throw new UnauthorizedException('Invalid MFA code');
    }

    const nextAttributes = {
      ...(user.attributes ?? {}),
      mfa_secret: secret,
    };
    delete (nextAttributes as Record<string, unknown>).mfa_pending_secret;

    const enabledAttributes = JSON.stringify(nextAttributes);
    await this.users
      .createQueryBuilder()
      .update()
      .set({
        mfaEnabled: true,
        attributes: () => `'${enabledAttributes.replace(/'/g, "''")}'::jsonb`,
      })
      .where('id = :id', { id: userId })
      .execute();
  }

  async disableMfa(userId: string, currentPassword: string): Promise<void> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: {
        id: true,
        passwordHash: true,
        mfaEnabled: true,
        attributes: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.mfaEnabled) {
      return;
    }
    if (
      !user.passwordHash ||
      !(await argon2.verify(user.passwordHash, currentPassword))
    ) {
      throw new UnauthorizedException('Current password is invalid');
    }

    const nextAttributes = { ...(user.attributes ?? {}) };
    delete nextAttributes.mfa_secret;
    delete nextAttributes.mfa_pending_secret;

    const disabledAttributes = JSON.stringify(nextAttributes);
    await this.users
      .createQueryBuilder()
      .update()
      .set({
        mfaEnabled: false,
        attributes: () => `'${disabledAttributes.replace(/'/g, "''")}'::jsonb`,
      })
      .where('id = :id', { id: userId })
      .execute();
  }

  async getSessionProfile(user: JwtPayload): Promise<{
    id: string;
    tenantId: string;
    roles: string[];
    permissions: string[];
    clearance: number;
    sessionId: string;
    mfaEnabled: boolean;
  }> {
    const [sessionUser, roleCodes, permissions] = await Promise.all([
      this.users.findOne({
        where: { id: user.sub },
        select: { id: true, mfaEnabled: true },
      }),
      this.getRoleCodes(user.sub, user.tid),
      this.getPermissionCodes(user.sub, user.tid),
    ]);

    return {
      id: user.sub,
      tenantId: user.tid,
      roles: roleCodes,
      permissions,
      clearance: user.clearance,
      sessionId: user.sessionId,
      mfaEnabled: sessionUser?.mfaEnabled ?? false,
    };
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
    const expiryMs = this.parseMs(
      this.config.get<string>('JWT_REFRESH_EXPIRY', '8h'),
    );

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

    const accessToken = this.jwt.sign(payload as any, {
      expiresIn: accessExpiry as any,
    });
    return {
      accessToken,
      refreshToken: rawToken,
      expiresIn: this.parseMs(accessExpiry) / 1000,
    };
  }

  private async getRoleCodes(
    userId: string,
    tenantId: string,
  ): Promise<string[]> {
    const userRoles = await this.userRoles
      .createQueryBuilder('userRole')
      .innerJoinAndSelect('userRole.role', 'role')
      .where('userRole.user_id = :userId', { userId })
      .andWhere('(userRole.expires_at IS NULL OR userRole.expires_at > NOW())')
      .andWhere('(role.tenant_id IS NULL OR role.tenant_id = :tenantId)', {
        tenantId,
      })
      .getMany();

    return [...new Set(userRoles.map((userRole) => userRole.role.code))];
  }

  private async getPermissionCodes(
    userId: string,
    tenantId: string,
  ): Promise<string[]> {
    const rows = await this.userRoles
      .createQueryBuilder('userRole')
      .innerJoin('iam.roles', 'role', 'role.id = userRole.role_id')
      .innerJoin(
        'iam.role_permissions',
        'rolePermission',
        'rolePermission.role_id = role.id',
      )
      .innerJoin(
        'iam.permissions',
        'permission',
        'permission.id = rolePermission.permission_id',
      )
      .where('userRole.user_id = :userId', { userId })
      .andWhere('(userRole.expires_at IS NULL OR userRole.expires_at > NOW())')
      .andWhere('(role.tenant_id IS NULL OR role.tenant_id = :tenantId)', {
        tenantId,
      })
      .select('permission.code', 'code')
      .getRawMany<{ code: string }>();

    return [...new Set(rows.map((row) => row.code))];
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  private parseMs(duration: string): number {
    const units: Record<string, number> = {
      s: 1000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match) return 600_000;
    return parseInt(match[1], 10) * units[match[2]];
  }
}
