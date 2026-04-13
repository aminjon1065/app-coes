import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  } as unknown as Reflector;

  const createContext = (roles: string[]): ExecutionContext =>
    ({
      getHandler: () => 'handler',
      getClass: () => 'class',
      switchToHttp: () => ({
        getRequest: () => ({
          user: {
            id: 'user-1',
            tenantId: 'tenant-1',
            roles,
            clearance: 2,
            sessionId: 'session-1',
          },
        }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows when no roles metadata is set', () => {
    reflector.getAllAndOverride = jest.fn().mockReturnValue(undefined);
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(createContext(['duty_operator']))).toBe(true);
  });

  it('allows when any required role is present', () => {
    reflector.getAllAndOverride = jest.fn().mockReturnValue(['tenant_admin']);
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(createContext(['tenant_admin']))).toBe(true);
  });

  it('allows platform_admin regardless of required role', () => {
    reflector.getAllAndOverride = jest.fn().mockReturnValue(['shift_lead']);
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(createContext(['platform_admin']))).toBe(true);
  });

  it('rejects when required role is missing', () => {
    reflector.getAllAndOverride = jest.fn().mockReturnValue(['tenant_admin']);
    const guard = new RolesGuard(reflector);

    expect(() => guard.canActivate(createContext(['duty_operator']))).toThrow(
      ForbiddenException,
    );
  });
});
