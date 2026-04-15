import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { TenantAccessGuard } from './tenant-access.guard';

describe('TenantAccessGuard', () => {
  const createContext = (
    tenantId?: string,
    headerTenantId?: string,
  ): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          user: tenantId
            ? {
                id: 'user-1',
                tenantId,
                roles: ['tenant_admin'],
                clearance: 2,
                sessionId: 'session-1',
              }
            : undefined,
          headers: {
            ...(headerTenantId ? { 'x-tenant-id': headerTenantId } : {}),
          },
        }),
      }),
    }) as unknown as ExecutionContext;

  it('allows matching tenant header', () => {
    const guard = new TenantAccessGuard();

    expect(guard.canActivate(createContext('tenant-1', 'tenant-1'))).toBe(true);
  });

  it('allows when tenant header is absent', () => {
    const guard = new TenantAccessGuard();

    expect(guard.canActivate(createContext('tenant-1'))).toBe(true);
  });

  it('rejects missing tenant context', () => {
    const guard = new TenantAccessGuard();

    expect(() => guard.canActivate(createContext(undefined))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects cross-tenant header', () => {
    const guard = new TenantAccessGuard();

    expect(() =>
      guard.canActivate(createContext('tenant-1', 'tenant-2')),
    ).toThrow(ForbiddenException);
  });
});
