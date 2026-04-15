import { NotFoundException } from '@nestjs/common';
import { DatabaseContextService } from '../../../shared/database/database-context.service';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { Tenant } from '../entities/tenant.entity';
import { UsersService } from './users.service';

describe('UsersService tenant access', () => {
  let service: UsersService;
  let dataSource: { getRepository: jest.Mock };
  let databaseContext: jest.Mocked<Partial<DatabaseContextService>>;
  let users: jest.Mocked<Partial<Repository<User>>>;
  let tenants: jest.Mocked<Partial<Repository<Tenant>>>;

  beforeEach(() => {
    dataSource = {
      getRepository: jest.fn(),
    };
    databaseContext = {
      getRepository: jest.fn(),
    };
    users = {
      findOne: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
    };
    tenants = {
      findOne: jest.fn(),
    };
    databaseContext
      .getRepository!.mockReturnValueOnce(users as Repository<User>)
      .mockReturnValueOnce(tenants as Repository<Tenant>);

    service = new UsersService(
      dataSource as never,
      databaseContext as DatabaseContextService,
    );
  });

  it('findOne scopes lookup to tenant', async () => {
    users.findOne!.mockResolvedValue({
      id: 'user-1',
      tenantId: 'tenant-1',
    } as User);

    await service.findOne('tenant-1', 'user-1');

    expect(users.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1', tenantId: 'tenant-1' },
      }),
    );
  });

  it('softDelete scopes deletion to tenant', async () => {
    users.softDelete!.mockResolvedValue({ affected: 1 } as never);

    await service.softDelete('tenant-1', 'user-1');

    expect(users.softDelete).toHaveBeenCalledWith({
      id: 'user-1',
      tenantId: 'tenant-1',
    });
  });

  it('throws when user is not found in tenant scope', async () => {
    users.findOne!.mockResolvedValue(null);

    await expect(service.findOne('tenant-1', 'user-2')).rejects.toThrow(
      NotFoundException,
    );
  });
});
