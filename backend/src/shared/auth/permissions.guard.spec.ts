import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthorizationService } from '../../modules/iam/services/authorization.service';
import { PermissionsGuard } from './permissions.guard';

describe('PermissionsGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  } as unknown as Reflector;

  const authorization = {
    getPermissionsForUser: jest.fn(),
    hasPermissions: jest.fn(),
  } as unknown as AuthorizationService;

  const createContext = (
    roles: string[],
    permissions?: string[],
  ): ExecutionContext =>
    ({
      getHandler: () => 'handler',
      getClass: () => 'class',
      switchToHttp: () => ({
        getRequest: () => ({
          user: {
            id: 'user-1',
            tenantId: 'tenant-1',
            roles,
            permissions,
            clearance: 2,
            sessionId: 'session-1',
          },
        }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows when no permissions metadata is set', async () => {
    reflector.getAllAndOverride = jest.fn().mockReturnValue(undefined);
    const guard = new PermissionsGuard(reflector, authorization);

    await expect(
      guard.canActivate(createContext(['duty_operator'])),
    ).resolves.toBe(true);
  });

  it('loads permissions and allows access', async () => {
    reflector.getAllAndOverride = jest.fn().mockReturnValue(['iam.users.read']);
    authorization.getPermissionsForUser = jest
      .fn()
      .mockResolvedValue(['iam.users.read']);
    authorization.hasPermissions = jest.fn().mockReturnValue(true);
    const guard = new PermissionsGuard(reflector, authorization);

    await expect(
      guard.canActivate(createContext(['tenant_admin'])),
    ).resolves.toBe(true);
    expect(authorization.getPermissionsForUser).toHaveBeenCalledWith(
      'user-1',
      'tenant-1',
    );
  });

  it('rejects when permission is missing', async () => {
    reflector.getAllAndOverride = jest
      .fn()
      .mockReturnValue(['iam.users.delete']);
    authorization.getPermissionsForUser = jest
      .fn()
      .mockResolvedValue(['iam.users.read']);
    authorization.hasPermissions = jest.fn().mockReturnValue(false);
    const guard = new PermissionsGuard(reflector, authorization);

    await expect(
      guard.canActivate(createContext(['tenant_admin'])),
    ).rejects.toThrow(ForbiddenException);
  });
});
