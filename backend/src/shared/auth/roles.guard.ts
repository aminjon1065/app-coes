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
import { ROLES_KEY } from './roles.decorator';

type RequestWithUser = Request & { user?: RequestUser };

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    const activeRoles = await this.authorization.getActiveRoleCodesForUser(
      user.id,
      user.tenantId,
    );
    user.roles = activeRoles;

    if (activeRoles.includes('platform_admin')) {
      return true;
    }

    if (!requiredRoles.some((role) => activeRoles.includes(role))) {
      throw new ForbiddenException('Insufficient role');
    }

    return true;
  }
}
