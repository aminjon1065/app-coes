import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, IsNull } from 'typeorm';
import * as argon2 from 'argon2';
import { Tenant } from '../entities/tenant.entity';
import { User } from '../entities/user.entity';
import { Role } from '../entities/role.entity';
import { UserRole } from '../entities/user-role.entity';

@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const enabled =
      this.config.get<string>('SEED_ADMIN_ENABLED', 'true') !== 'false';
    if (!enabled) {
      return;
    }

    const email = this.config.get<string>('SEED_ADMIN_EMAIL');
    const password = this.config.get<string>('SEED_ADMIN_PASSWORD');
    const tenantCode = this.config.get<string>('SEED_TENANT_CODE', 'tj-dushanbe');
    const tenantName = this.config.get<string>(
      'SEED_TENANT_NAME',
      'Dushanbe National HQ',
    );
    const roleCodes = this.parseRoleCodes(
      this.config.get<string>(
        'SEED_ADMIN_ROLES',
        'platform_admin,tenant_admin',
      ),
    );

    if (!email || !password) {
      this.logger.debug('Admin bootstrap skipped: SEED_ADMIN_EMAIL/PASSWORD not set');
      return;
    }

    await this.dataSource.transaction(async (manager) => {
      let tenant = await manager.findOne(Tenant, {
        where: { code: tenantCode },
      });

      if (!tenant) {
        tenant = manager.create(Tenant, {
          code: tenantCode,
          name: tenantName,
          region: null,
          status: 'active',
          settings: {},
        });
        tenant = await manager.save(Tenant, tenant);
        this.logger.log(`Created bootstrap tenant ${tenant.code}`);
      }

      let user = await manager.findOne(User, {
        where: { email: email.toLowerCase() },
        select: {
          id: true,
          email: true,
          tenantId: true,
          status: true,
        },
      });

      if (!user) {
        const passwordHash = await argon2.hash(password, {
          type: argon2.argon2id,
          memoryCost: 65_536,
          timeCost: 3,
          parallelism: 4,
        });

        user = manager.create(User, {
          tenantId: tenant.id,
          email: email.toLowerCase(),
          fullName: 'System Administrator',
          phone: null,
          passwordHash,
          clearance: 4,
          status: 'active',
          mfaEnabled: false,
          attributes: {},
        });
        user = await manager.save(User, user);
        this.logger.log(`Created bootstrap admin user ${user.email}`);
      } else if (user.tenantId !== tenant.id) {
        this.logger.warn(
          `Bootstrap admin ${user.email} exists in another tenant; role assignment skipped`,
        );
        return;
      }

      if (roleCodes.length === 0) {
        this.logger.warn('Bootstrap admin has no configured roles');
        return;
      }

      const roles = await manager.find(Role, {
        where: roleCodes.map((code) => ({ code, tenantId: IsNull() })),
      });

      for (const roleCode of roleCodes) {
        const role = roles.find((candidate) => candidate.code === roleCode);
        if (!role) {
          this.logger.warn(`Bootstrap role ${roleCode} not found; skipping`);
          continue;
        }

        const existingAssignment = await manager.findOne(UserRole, {
          where: { userId: user.id, roleId: role.id },
        });

        if (!existingAssignment) {
          const assignment = manager.create(UserRole, {
            userId: user.id,
            roleId: role.id,
            scope: {},
            grantedBy: user.id,
            expiresAt: null,
          });
          await manager.save(UserRole, assignment);
          this.logger.log(`Assigned bootstrap role ${role.code} to ${user.email}`);
        }
      }
    });
  }

  private parseRoleCodes(raw: string): string[] {
    return [...new Set(raw.split(',').map((role) => role.trim()).filter(Boolean))];
  }
}
