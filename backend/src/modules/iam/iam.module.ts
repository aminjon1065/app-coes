import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { Tenant } from './entities/tenant.entity';
import { User } from './entities/user.entity';
import { Role } from './entities/role.entity';
import { Permission } from './entities/permission.entity';
import { RolePermission } from './entities/role-permission.entity';
import { UserRole } from './entities/user-role.entity';
import { Session } from './entities/session.entity';

import { TotpService } from './services/totp.service';
import { AdminBootstrapService } from './services/admin-bootstrap.service';
import { AuthService } from './services/auth.service';
import { UsersService } from './services/users.service';
import { AuthorizationService } from './services/authorization.service';

import { AuthController } from './controllers/auth.controller';
import { UsersController } from './controllers/users.controller';

import { JwtStrategy } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RolesGuard } from '../../shared/auth/roles.guard';
import { TenantAccessGuard } from '../../shared/auth/tenant-access.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Tenant,
      User,
      Role,
      Permission,
      RolePermission,
      UserRole,
      Session,
    ]),

    PassportModule.register({ defaultStrategy: 'jwt' }),

    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET', 'dev-access-secret-min-32-chars-change-me'),
        signOptions: {
          expiresIn: config.get<string>('JWT_ACCESS_EXPIRY', '10m') as any,
          issuer: config.get<string>('JWT_ISSUER', 'coescd'),
          audience: config.get<string>('JWT_AUDIENCE', 'coescd-clients'),
        },
      }),
    }),
  ],
  controllers: [AuthController, UsersController],
  providers: [
    TotpService,
    AdminBootstrapService,
    AuthService,
    UsersService,
    AuthorizationService,
    JwtStrategy,
    RolesGuard,
    PermissionsGuard,
    TenantAccessGuard,
  ],
  exports: [
    AuthService,
    UsersService,
    AuthorizationService,
    JwtModule,
    RolesGuard,
    PermissionsGuard,
    TenantAccessGuard,
  ],
})
export class IamModule {}
