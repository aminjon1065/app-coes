import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { DataSource, Repository } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { RequestUser } from '../../../shared/auth/current-user.decorator';
import { DatabaseContextService } from '../../../shared/database/database-context.service';
import {
  ActivateBreakGlassDto,
  BREAK_GLASS_ROLE_CODES,
} from '../dto/break-glass.dto';
import { Role } from '../entities/role.entity';
import { User } from '../entities/user.entity';
import { UserRole } from '../entities/user-role.entity';

type BreakGlassScope = {
  breakGlass: true;
  reason: string;
  actorId: string;
  grantedAt: string;
};

@Injectable()
export class SecurityService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly databaseContext: DatabaseContextService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  private get users(): Repository<User> {
    return this.databaseContext.getRepository(this.dataSource, User);
  }

  private get roles(): Repository<Role> {
    return this.databaseContext.getRepository(this.dataSource, Role);
  }

  private get userRoles(): Repository<UserRole> {
    return this.databaseContext.getRepository(this.dataSource, UserRole);
  }

  async activateBreakGlass(actor: RequestUser, dto: ActivateBreakGlassDto) {
    if (!BREAK_GLASS_ROLE_CODES.includes(dto.roleCode)) {
      throw new ForbiddenException(
        'Requested role is not allowed for break-glass',
      );
    }

    if (
      actor.roles.includes('shift_lead') &&
      !actor.roles.includes('platform_admin') &&
      dto.roleCode !== 'incident_commander'
    ) {
      throw new ForbiddenException(
        'Shift lead may only grant temporary incident commander access',
      );
    }

    const target = await this.users.findOne({
      where: { id: dto.targetUserId, tenantId: actor.tenantId },
      select: {
        id: true,
        tenantId: true,
        email: true,
        fullName: true,
        status: true,
      },
    });
    if (!target) {
      throw new NotFoundException('Target user not found');
    }
    if (target.status !== 'active') {
      throw new ConflictException('Break-glass requires an active target user');
    }
    if (target.id === actor.id) {
      throw new ConflictException('Break-glass cannot target the current user');
    }

    const role = await this.roles
      .createQueryBuilder('role')
      .where('role.code = :code', { code: dto.roleCode })
      .andWhere('(role.tenant_id IS NULL OR role.tenant_id = :tenantId)', {
        tenantId: actor.tenantId,
      })
      .orderBy('role.tenant_id', 'DESC')
      .getOne();
    if (!role) {
      throw new NotFoundException(`Role ${dto.roleCode} not found`);
    }

    const existingAssignment = await this.userRoles.findOne({
      where: {
        userId: target.id,
        roleId: role.id,
      },
    });
    if (
      existingAssignment &&
      !this.isBreakGlassScope(existingAssignment.scope)
    ) {
      throw new ConflictException('Target user already has this role');
    }

    const now = new Date();
    const durationHours = Math.min(Math.max(dto.durationHours ?? 4, 1), 4);
    const expiresAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000);
    const scope: BreakGlassScope = {
      breakGlass: true,
      reason: dto.reason,
      actorId: actor.id,
      grantedAt: now.toISOString(),
    };

    if (existingAssignment) {
      await this.userRoles.update(
        { userId: target.id, roleId: role.id },
        {
          scope,
          grantedBy: actor.id,
          expiresAt,
        },
      );
    } else {
      await this.userRoles.insert({
        userId: target.id,
        roleId: role.id,
        scope,
        grantedBy: actor.id,
        expiresAt,
      } as never);
    }

    await this.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.id,
      eventType: 'iam.breakglass.activated.v1',
      targetType: 'user',
      targetId: target.id,
      before: existingAssignment
        ? {
            roleCode: dto.roleCode,
            previousExpiresAt:
              existingAssignment.expiresAt?.toISOString() ?? null,
            previousScope: existingAssignment.scope ?? {},
          }
        : null,
      after: {
        roleCode: dto.roleCode,
        reason: dto.reason,
        expiresAt: expiresAt.toISOString(),
        targetEmail: target.email,
      },
      sessionId: actor.sessionId,
    });

    this.events.emit('iam.breakglass.activated.v1', {
      tenantId: actor.tenantId,
      actorId: actor.id,
      userId: target.id,
      after: {
        roleCode: dto.roleCode,
        reason: dto.reason,
        expiresAt: expiresAt.toISOString(),
      },
      sessionId: actor.sessionId,
    });

    return {
      targetUserId: target.id,
      roleCode: dto.roleCode,
      expiresAt: expiresAt.toISOString(),
    };
  }

  @Cron('0 * * * * *')
  async revokeExpiredBreakGlassAssignments() {
    const expired = await this.userRoles
      .createQueryBuilder('userRole')
      .innerJoinAndSelect('userRole.role', 'role')
      .innerJoinAndSelect('userRole.user', 'user')
      .where('userRole.expires_at IS NOT NULL')
      .andWhere('userRole.expires_at <= NOW()')
      .andWhere(`COALESCE(userRole.scope->>'breakGlass', 'false') = 'true'`)
      .getMany();

    if (!expired.length) {
      return;
    }

    for (const assignment of expired) {
      const revokedAt = new Date().toISOString();

      await this.userRoles.delete({
        userId: assignment.userId,
        roleId: assignment.roleId,
      });

      await this.audit.record({
        tenantId: assignment.user.tenantId,
        actorId: null,
        eventType: 'iam.breakglass.revoked.v1',
        targetType: 'user',
        targetId: assignment.userId,
        before: {
          roleCode: assignment.role?.code ?? null,
          expiresAt: assignment.expiresAt?.toISOString() ?? null,
          scope: assignment.scope ?? {},
        },
        after: {
          revokedAt,
        },
      });

      this.events.emit('iam.breakglass.revoked.v1', {
        tenantId: assignment.user.tenantId,
        actorId: null,
        userId: assignment.userId,
        after: {
          roleCode: assignment.role?.code ?? null,
          revokedAt,
        },
      });
    }
  }

  private isBreakGlassScope(
    value: Record<string, unknown> | null | undefined,
  ): value is BreakGlassScope {
    return Boolean(
      value && value.breakGlass === true && typeof value.reason === 'string',
    );
  }
}
