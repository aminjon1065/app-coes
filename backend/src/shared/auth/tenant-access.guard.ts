import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import type { RequestUser } from './current-user.decorator';

type RequestWithUser = Request & { user?: RequestUser };

@Injectable()
export class TenantAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user?.tenantId) {
      throw new ForbiddenException('Missing tenant context');
    }

    const headerTenantId = request.headers['x-tenant-id'];
    const requestedTenantId = Array.isArray(headerTenantId)
      ? headerTenantId[0]
      : headerTenantId;

    if (requestedTenantId && requestedTenantId !== user.tenantId) {
      throw new ForbiddenException('Cross-tenant access denied');
    }

    return true;
  }
}
