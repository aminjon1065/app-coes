import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AnalyticsService } from './analytics.service';

const actor = {
  id: 'user-1',
  tenantId: 'tenant-1',
  roles: ['analyst'],
  clearance: 4,
  sessionId: 'session-1',
};

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  const dataSource = { query: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();
    service = moduleRef.get(AnalyticsService);
  });

  it('returns summary with overdue task count', async () => {
    dataSource.query
      .mockResolvedValueOnce([
        {
          openIncidents: 2,
          closedIncidents: 1,
          avgResolutionMinutes: 45,
          tasksTotal: 10,
          tasksDone: 6,
          tasksBreachedSla: 1,
          participantsTotal: 8,
          sitrepsTotal: 4,
        },
      ])
      .mockResolvedValueOnce([{ overdueTasks: 3 }]);

    const result = await service.summary(actor as any, {});

    expect(result.openIncidents).toBe(2);
    expect(result.overdueTasks).toBe(3);
    expect(dataSource.query).toHaveBeenCalledTimes(2);
  });

  it('exports analytics rows as CSV', async () => {
    dataSource.query.mockResolvedValueOnce([
      {
        incident_id: 'incident-1',
        opened_at: '2026-04-01T00:00:00.000Z',
        status_final: 'closed',
      },
    ]);

    const csv = await service.exportCsv(actor as any, { type: 'incidents' });

    expect(csv).toContain('"incident_id"');
    expect(csv).toContain('"incident-1"');
  });
});
