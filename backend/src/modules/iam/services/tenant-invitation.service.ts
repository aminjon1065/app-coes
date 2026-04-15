import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import * as argon2 from 'argon2';
import { RequestUser } from '../../../shared/auth/current-user.decorator';
import { DatabaseContextService } from '../../../shared/database/database-context.service';
import { IncidentParticipant } from '../../incident/entities/incident-participant.entity';
import { Incident } from '../../incident/entities/incident.entity';
import { CreateTenantInvitationDto } from '../dto/create-tenant-invitation.dto';
import { AcceptInvitationDto } from '../dto/accept-invitation.dto';
import { Role } from '../entities/role.entity';
import { Tenant } from '../entities/tenant.entity';
import { TenantInvitation } from '../entities/tenant-invitation.entity';
import { UserRole } from '../entities/user-role.entity';
import { User } from '../entities/user.entity';

type InvitationPayload = {
  jti: string;
  tid: string;
  email: string;
  roleCode: 'agency_liaison';
  incidentScope: string[];
  invitedBy: string;
};

type StoredInvitation = {
  id: string;
  tenantId: string;
  email: string;
  roleCode: string;
  incidentScope: string[];
  token: string;
  invitedBy: string;
  acceptedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
};

@Injectable()
export class TenantInvitationService {
  private readonly logger = new Logger(TenantInvitationService.name);
  private readonly memoryStore = new Map<string, StoredInvitation>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly databaseContext: DatabaseContextService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
  ) {}

  private get invitations(): Repository<TenantInvitation> {
    return this.databaseContext.getRepository(
      this.dataSource,
      TenantInvitation,
    );
  }

  private get tenants(): Repository<Tenant> {
    return this.databaseContext.getRepository(this.dataSource, Tenant);
  }

  private get users(): Repository<User> {
    return this.databaseContext.getRepository(this.dataSource, User);
  }

  private get roles(): Repository<Role> {
    return this.databaseContext.getRepository(this.dataSource, Role);
  }

  private get userRoles(): Repository<UserRole> {
    return this.databaseContext.getRepository(this.dataSource, UserRole);
  }

  private get participants(): Repository<IncidentParticipant> {
    return this.databaseContext.getRepository(
      this.dataSource,
      IncidentParticipant,
    );
  }

  private get incidents(): Repository<Incident> {
    return this.databaseContext.getRepository(this.dataSource, Incident);
  }

  async create(
    actor: RequestUser,
    tenantId: string,
    dto: CreateTenantInvitationDto,
  ) {
    this.assertTenantInviteAccess(actor, tenantId);

    const email = dto.email.trim().toLowerCase();
    const incidentScope = await this.normalizeIncidentScope(
      tenantId,
      dto.incidentScope ?? [],
    );
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const invitationId = crypto.randomUUID();
    const token = this.jwt.sign(
      {
        jti: invitationId,
        tid: tenantId,
        email,
        roleCode: 'agency_liaison',
        incidentScope,
        invitedBy: actor.id,
      } satisfies InvitationPayload,
      {
        expiresIn: '24h',
        audience: this.inviteAudience(),
        issuer: this.inviteIssuer(),
      },
    );

    const existingUser = await this.users.findOne({
      where: { email },
      select: { id: true, tenantId: true },
    });
    if (existingUser) {
      throw new ConflictException('Email is already registered.');
    }

    const duplicate = await this.findActiveInvitationByEmail(email, tenantId);
    if (duplicate) {
      throw new ConflictException(
        'An active invitation already exists for this email.',
      );
    }

    const stored: StoredInvitation = {
      id: invitationId,
      tenantId,
      email,
      roleCode: 'agency_liaison',
      incidentScope,
      token,
      invitedBy: actor.id,
      acceptedAt: null,
      expiresAt,
      createdAt: new Date(),
    };

    await this.saveInvitation(stored);
    const inviteUrl = `${this.frontendBaseUrl()}/accept-invite?token=${encodeURIComponent(token)}`;

    this.events.emit('iam.tenant_invitation.created', {
      tenantId,
      actorId: actor.id,
      userId: actor.id,
      after: {
        invitationId: stored.id,
        email,
        roleCode: stored.roleCode,
        incidentScope,
        expiresAt: expiresAt.toISOString(),
      },
    });

    this.logger.log(`Created liaison invitation for ${email} (${tenantId})`);

    return {
      id: stored.id,
      tenantId,
      email,
      roleCode: stored.roleCode,
      incidentScope,
      expiresAt: expiresAt.toISOString(),
      inviteUrl,
      delivery: 'link_only',
    };
  }

  async resolve(token: string) {
    const invitation = await this.loadInvitation(token);

    return {
      id: invitation.id,
      tenantId: invitation.tenantId,
      email: invitation.email,
      roleCode: invitation.roleCode,
      incidentScope: invitation.incidentScope,
      expiresAt: invitation.expiresAt.toISOString(),
      acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
    };
  }

  async accept(dto: AcceptInvitationDto) {
    const token = dto.token.trim();
    const invitation = await this.loadInvitation(token);
    const normalizedEmail = dto.email.trim().toLowerCase();

    if (normalizedEmail !== invitation.email) {
      throw new BadRequestException(
        'Invitation email does not match the submitted email.',
      );
    }

    const manager =
      this.databaseContext.getManager() ?? this.dataSource.manager;
    const createdUser = await this.databaseContext.runWithManager(
      manager,
      async () =>
        this.dataSource.transaction(async (txManager) => {
          const userRepo = txManager.getRepository(User);
          const roleRepo = txManager.getRepository(Role);
          const userRoleRepo = txManager.getRepository(UserRole);
          const participantRepo = txManager.getRepository(IncidentParticipant);
          const incidentRepo = txManager.getRepository(Incident);

          const existing = await userRepo.findOne({
            where: { email: normalizedEmail },
            select: { id: true },
          });
          if (existing) {
            throw new ConflictException('Email is already registered.');
          }

          const passwordHash = await argon2.hash(dto.password, {
            type: argon2.argon2id,
            memoryCost: 65_536,
            timeCost: 3,
            parallelism: 4,
          });

          const user = userRepo.create({
            tenantId: invitation.tenantId,
            email: normalizedEmail,
            fullName: dto.fullName.trim(),
            phone: dto.phone?.trim() || null,
            passwordHash,
            clearance: 1,
            status: 'active',
            mfaEnabled: false,
            attributes: {
              invitationId: invitation.id,
              liaisonIncidentScope: invitation.incidentScope,
            },
          });
          const savedUser = await userRepo.save(user);

          const liaisonRole = await roleRepo.findOne({
            where: { code: 'agency_liaison', tenantId: IsNull() },
          });
          if (!liaisonRole) {
            throw new NotFoundException(
              'agency_liaison role is not configured.',
            );
          }

          await userRoleRepo.save(
            userRoleRepo.create({
              userId: savedUser.id,
              roleId: liaisonRole.id,
              grantedBy: invitation.invitedBy,
              expiresAt: null,
              scope: {
                incidentScope: invitation.incidentScope,
                invitationId: invitation.id,
              },
            }),
          );

          if (invitation.incidentScope.length > 0) {
            const incidents = await incidentRepo.find({
              where: {
                id: In(invitation.incidentScope),
                tenantId: invitation.tenantId,
              },
              select: { id: true },
            });

            for (const incident of incidents) {
              const existingParticipant = await participantRepo.findOne({
                where: { incidentId: incident.id, userId: savedUser.id },
              });

              if (existingParticipant) {
                existingParticipant.roleInIncident = 'liaison';
                existingParticipant.leftAt = null;
                await participantRepo.save(existingParticipant);
                continue;
              }

              await participantRepo.save(
                participantRepo.create({
                  incidentId: incident.id,
                  userId: savedUser.id,
                  roleInIncident: 'liaison',
                  leftAt: null,
                }),
              );
            }
          }

          return savedUser;
        }),
    );

    await this.markAccepted(invitation.id, token);

    this.events.emit('iam.tenant_invitation.accepted', {
      tenantId: invitation.tenantId,
      actorId: createdUser.id,
      userId: createdUser.id,
      after: {
        invitationId: invitation.id,
        email: normalizedEmail,
        roleCode: invitation.roleCode,
        incidentScope: invitation.incidentScope,
      },
    });

    return {
      id: createdUser.id,
      email: createdUser.email,
      fullName: createdUser.fullName,
      tenantId: createdUser.tenantId,
    };
  }

  private async normalizeIncidentScope(
    tenantId: string,
    incidentIds: string[],
  ): Promise<string[]> {
    if (incidentIds.length === 0) {
      return [];
    }

    const incidents = await this.incidents.find({
      where: { id: In(incidentIds), tenantId },
      select: { id: true },
    });
    const resolved = incidents.map((item) => item.id);

    if (resolved.length !== incidentIds.length) {
      throw new NotFoundException(
        'One or more incident scope IDs are invalid.',
      );
    }

    return resolved;
  }

  private assertTenantInviteAccess(actor: RequestUser, tenantId: string) {
    const platformAdmin = actor.roles.includes('platform_admin');
    const sameTenant = actor.tenantId === tenantId;

    if (!platformAdmin && !sameTenant) {
      throw new ForbiddenException('Cross-tenant invitations are not allowed.');
    }
  }

  private async findActiveInvitationByEmail(email: string, tenantId: string) {
    const now = new Date();

    try {
      return await this.invitations.findOne({
        where: {
          email,
          tenantId,
          acceptedAt: IsNull(),
        },
        order: { createdAt: 'DESC' },
      });
    } catch {
      for (const invitation of this.memoryStore.values()) {
        if (
          invitation.email === email &&
          invitation.tenantId === tenantId &&
          !invitation.acceptedAt &&
          invitation.expiresAt > now
        ) {
          return invitation;
        }
      }
      return null;
    }
  }

  private async saveInvitation(invitation: StoredInvitation) {
    try {
      await this.invitations.save(
        this.invitations.create({
          ...invitation,
        }),
      );
      return;
    } catch (error) {
      this.logger.warn(
        `Tenant invitation persistence unavailable, falling back to memory store: ${String(error)}`,
      );
      this.memoryStore.set(invitation.token, invitation);
    }
  }

  private async loadInvitation(token: string): Promise<StoredInvitation> {
    const payload = this.verifyToken(token);
    let invitation: StoredInvitation | TenantInvitation | null = null;

    try {
      invitation = await this.invitations.findOne({
        where: { token },
      });
    } catch {
      invitation = this.memoryStore.get(token) ?? null;
    }

    if (!invitation) {
      throw new NotFoundException('Invitation not found.');
    }

    if (invitation.acceptedAt) {
      throw new ConflictException('Invitation has already been accepted.');
    }

    if (new Date(invitation.expiresAt) <= new Date()) {
      throw new UnauthorizedException('Invitation has expired.');
    }

    if (payload.jti !== invitation.id || payload.tid !== invitation.tenantId) {
      throw new UnauthorizedException('Invitation token is invalid.');
    }

    return {
      id: invitation.id,
      tenantId: invitation.tenantId,
      email: invitation.email,
      roleCode: invitation.roleCode,
      incidentScope: invitation.incidentScope ?? [],
      token: invitation.token,
      invitedBy: invitation.invitedBy,
      acceptedAt: invitation.acceptedAt
        ? new Date(invitation.acceptedAt)
        : null,
      expiresAt: new Date(invitation.expiresAt),
      createdAt: new Date(invitation.createdAt),
    };
  }

  private verifyToken(token: string): InvitationPayload {
    try {
      return this.jwt.verify<InvitationPayload>(token, {
        audience: this.inviteAudience(),
        issuer: this.inviteIssuer(),
      });
    } catch {
      throw new UnauthorizedException(
        'Invitation token is invalid or expired.',
      );
    }
  }

  private async markAccepted(invitationId: string, token: string) {
    const acceptedAt = new Date();

    try {
      await this.invitations.update({ id: invitationId }, { acceptedAt });
      return;
    } catch {
      const invitation = this.memoryStore.get(token);
      if (invitation) {
        invitation.acceptedAt = acceptedAt;
        this.memoryStore.set(token, invitation);
      }
    }
  }

  private frontendBaseUrl() {
    return (
      this.config.get<string>('FRONTEND_URL') ??
      this.config.get<string>('NEXT_PUBLIC_APP_URL') ??
      'http://localhost:3000'
    ).replace(/\/$/, '');
  }

  private inviteAudience() {
    return `${this.config.get<string>('JWT_AUDIENCE', 'coescd-clients')}-invite`;
  }

  private inviteIssuer() {
    return `${this.config.get<string>('JWT_ISSUER', 'coescd')}-invite`;
  }
}
