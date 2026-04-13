import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AdminBootstrapService } from './admin-bootstrap.service';

describe('AdminBootstrapService', () => {
  it('skips when seed admin credentials are absent', async () => {
    const transaction = jest.fn();
    const dataSource = { transaction } as unknown as DataSource;
    const config = {
      get: jest.fn((key: string, defaultValue?: string) => {
        if (key === 'SEED_ADMIN_ENABLED') return 'true';
        return defaultValue;
      }),
    } as unknown as ConfigService;

    const service = new AdminBootstrapService(dataSource, config);

    await service.onApplicationBootstrap();

    expect(transaction).not.toHaveBeenCalled();
  });

  it('creates tenant, user and missing role assignments', async () => {
    const manager = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'role-tenant-admin' }),
      create: jest.fn((_entity, payload) => payload),
      save: jest
        .fn()
        .mockResolvedValueOnce({ id: 'tenant-1', code: 'tj-dushanbe' })
        .mockResolvedValueOnce({
          id: 'user-1',
          email: 'admin@coescd.local',
          tenantId: 'tenant-1',
        })
        .mockResolvedValueOnce({}),
      find: jest.fn().mockResolvedValue([{ id: 'role-tenant-admin', code: 'tenant_admin' }]),
    };

    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
    } as unknown as DataSource;
    const config = {
      get: jest.fn((key: string, defaultValue?: string) => {
        const values: Record<string, string> = {
          SEED_ADMIN_ENABLED: 'true',
          SEED_ADMIN_EMAIL: 'admin@coescd.local',
          SEED_ADMIN_PASSWORD: 'Admin123!',
          SEED_TENANT_CODE: 'tj-dushanbe',
          SEED_TENANT_NAME: 'Dushanbe National HQ',
          SEED_ADMIN_ROLES: 'tenant_admin',
        };
        return values[key] ?? defaultValue;
      }),
    } as unknown as ConfigService;

    const service = new AdminBootstrapService(dataSource, config);

    await service.onApplicationBootstrap();

    expect(dataSource.transaction).toHaveBeenCalled();
    expect(manager.find).toHaveBeenCalled();
    expect(manager.save).toHaveBeenCalledTimes(3);
  });
});
