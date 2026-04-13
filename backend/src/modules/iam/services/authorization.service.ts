import { Injectable, Logger } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Permission } from '../entities/permission.entity';
import { Role } from '../entities/role.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { UserRole } from '../entities/user-role.entity';
import { DatabaseContextService } from '../../../shared/database/database-context.service';

@Injectable()
export class AuthorizationService {
  private readonly logger = new Logger(AuthorizationService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly databaseContext: DatabaseContextService,
  ) {}

  private get userRoles(): Repository<UserRole> {
    return this.databaseContext.getRepository(this.dataSource, UserRole);
  }

  async getPermissionsForUser(
    userId: string,
    tenantId: string,
  ): Promise<string[]> {
    const rows = await this.userRoles
      .createQueryBuilder('userRole')
      .innerJoin(Role, 'role', 'role.id = userRole.role_id')
      .innerJoin(RolePermission, 'rolePermission', 'rolePermission.role_id = role.id')
      .innerJoin(Permission, 'permission', 'permission.id = rolePermission.permission_id')
      .where('userRole.user_id = :userId', { userId })
      .andWhere('(userRole.expires_at IS NULL OR userRole.expires_at > NOW())')
      .andWhere('(role.tenant_id IS NULL OR role.tenant_id = :tenantId)', {
        tenantId,
      })
      .select('permission.code', 'code')
      .getRawMany<{ code: string }>();

    const permissions = [...new Set(rows.map((row) => row.code))];
    this.logger.debug(
      { userId, tenantId, permissionsCount: permissions.length },
      'Resolved permissions for user',
    );

    return permissions;
  }

  hasPermissions(
    granted: string[],
    required: string[],
    roles: string[],
  ): boolean {
    if (!required.length) {
      return true;
    }

    if (roles.includes('platform_admin')) {
      return true;
    }

    const grantedSet = new Set(granted);
    return required.every((permission) => grantedSet.has(permission));
  }
}
