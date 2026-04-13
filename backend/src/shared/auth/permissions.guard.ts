import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthorizationService } from '../../modules/iam/services/authorization.service';
import type { RequestUser } from './current-user.decorator';
import { PERMISSIONS_KEY } from './permissions.decorator';

type RequestWithUser = Request & { user?: RequestUser };

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    const permissions =
      user.permissions ??
      (await this.authorization.getPermissionsForUser(user.id, user.tenantId));

    user.permissions = permissions;

    if (
      !this.authorization.hasPermissions(
        permissions,
        requiredPermissions,
        user.roles,
      )
    ) {
      throw new ForbiddenException('Missing required permissions');
    }

    return true;
  }
}
