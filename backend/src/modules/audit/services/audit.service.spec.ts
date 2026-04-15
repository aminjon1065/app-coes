import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DatabaseContextService } from '../../../shared/database/database-context.service';
import { AuditEventEntity } from '../entities/audit-event.entity';
import { AuditService } from './audit.service';

function createRepo() {
  return {
    createQueryBuilder: jest.fn(),
    findOne: jest.fn(),
    insert: jest.fn(),
    create: jest.fn((value) => value),
  };
}

describe('AuditService', () => {
  let service: AuditService;
  const repo = createRepo();

  beforeEach(async () => {
    jest.resetAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuditService,
        DatabaseContextService,
        { provide: DataSource, useValue: {} },
        { provide: getRepositoryToken(AuditEventEntity), useValue: repo },
      ],
    }).compile();

    service = moduleRef.get(AuditService);
    jest
      .spyOn(moduleRef.get(DatabaseContextService), 'getRepository')
      .mockImplementation((_dataSource, entity) => {
        if (entity === AuditEventEntity) {
          return repo as any;
        }
        throw new Error(`Unexpected entity: ${String(entity)}`);
      });
  });

  it('records events via insert only', async () => {
    repo.insert.mockResolvedValue(undefined);

    await service.record({
      tenantId: 'tenant-1',
      actorId: 'user-1',
      eventType: 'incident.created',
      targetType: 'incident',
      targetId: 'incident-1',
    });

    expect(repo.insert).toHaveBeenCalledTimes(1);
  });

  it('lists audit events with tenant scope for non-platform users', async () => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    repo.createQueryBuilder.mockReturnValue(qb);

    const result = await service.list(
      {
        id: 'user-1',
        tenantId: 'tenant-1',
        roles: ['auditor'],
        clearance: 4,
        sessionId: 'session-1',
      },
      {},
    );

    expect(qb.where).toHaveBeenCalledWith('audit.tenant_id = :tenantId', {
      tenantId: 'tenant-1',
    });
    expect(result.page.hasMore).toBe(false);
  });
});
