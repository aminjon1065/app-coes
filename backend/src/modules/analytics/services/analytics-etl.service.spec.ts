import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AnalyticsEtlService } from './analytics-etl.service';

describe('AnalyticsEtlService', () => {
  let service: AnalyticsEtlService;
  const dataSource = { query: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AnalyticsEtlService,
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();
    service = moduleRef.get(AnalyticsEtlService);
  });

  it('materializes incidents through an upsert', async () => {
    dataSource.query.mockResolvedValueOnce([]);

    await service.materializeIncident('incident-1');

    expect(dataSource.query.mock.calls[0][0]).toContain(
      'ON CONFLICT (incident_id)',
    );
    expect(dataSource.query.mock.calls[0][1]).toEqual(['incident-1']);
  });

  it('materializes tasks through an upsert', async () => {
    dataSource.query.mockResolvedValueOnce([]);

    await service.materializeTask('task-1');

    expect(dataSource.query.mock.calls[0][0]).toContain(
      'ON CONFLICT (task_id)',
    );
    expect(dataSource.query.mock.calls[0][1]).toEqual(['task-1']);
  });
});
