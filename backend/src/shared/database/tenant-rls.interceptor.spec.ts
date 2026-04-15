import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { DataSource } from 'typeorm';
import { DatabaseContextService } from './database-context.service';
import { TenantRlsInterceptor } from './tenant-rls.interceptor';

describe('TenantRlsInterceptor', () => {
  const createContext = (
    tenantId?: string,
    roles: string[] = [],
  ): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          user: tenantId
            ? {
                id: 'user-1',
                tenantId,
                roles,
                clearance: 2,
                sessionId: 'session-1',
              }
            : undefined,
        }),
      }),
    }) as unknown as ExecutionContext;

  it('passes through when request has no tenant user', async () => {
    const dataSource = {} as DataSource;
    const databaseContext = {} as DatabaseContextService;
    const interceptor = new TenantRlsInterceptor(dataSource, databaseContext);
    const next: CallHandler = { handle: () => of('ok') };

    await expect(
      interceptor.intercept(createContext(undefined), next).toPromise(),
    ).resolves.toBe('ok');
  });

  it('skips transaction for platform admin', async () => {
    const dataSource = {} as DataSource;
    const databaseContext = {} as DatabaseContextService;
    const interceptor = new TenantRlsInterceptor(dataSource, databaseContext);
    const next: CallHandler = { handle: () => of('ok') };

    await expect(
      interceptor
        .intercept(createContext('tenant-1', ['platform_admin']), next)
        .toPromise(),
    ).resolves.toBe('ok');
  });

  it('sets local tenant id within transaction', async () => {
    const query = jest.fn();
    const startTransaction = jest.fn();
    const commitTransaction = jest.fn();
    const rollbackTransaction = jest.fn();
    const release = jest.fn();
    const connect = jest.fn();
    const manager = {};
    const queryRunner = {
      connect,
      startTransaction,
      query,
      manager,
      commitTransaction,
      rollbackTransaction,
      release,
    };

    const dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    } as unknown as DataSource;

    const databaseContext = {
      runWithManager: jest
        .fn()
        .mockImplementation((_manager, callback) => callback()),
    } as unknown as DatabaseContextService;

    const interceptor = new TenantRlsInterceptor(dataSource, databaseContext);
    const next: CallHandler = { handle: () => of('ok') };

    await expect(
      interceptor.intercept(createContext('tenant-42'), next).toPromise(),
    ).resolves.toBe('ok');

    expect(query).toHaveBeenCalledWith('SET LOCAL app.tenant_id = $1', [
      'tenant-42',
    ]);
    expect(commitTransaction).toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
  });
});
