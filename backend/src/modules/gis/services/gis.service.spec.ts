import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { DatabaseContextService } from '../../../shared/database/database-context.service';
import { IncidentParticipant } from '../../incident/entities/incident-participant.entity';
import { Incident } from '../../incident/entities/incident.entity';
import { Task } from '../../task/entities/task.entity';
import { MapFeature } from '../entities/map-feature.entity';
import { MapLayer } from '../entities/map-layer.entity';
import { GisService } from './gis.service';

function createRepo() {
  return {
    createQueryBuilder: jest.fn(),
    create: jest.fn((value) => value),
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
  };
}

describe('GisService', () => {
  let service: GisService;
  const layerRepo = createRepo();
  const featureRepo = createRepo();
  const incidentRepo = createRepo();
  const participantRepo = createRepo();
  const taskRepo = createRepo();
  const dataSource = { query: jest.fn() };
  const events = { emit: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        GisService,
        DatabaseContextService,
        { provide: DataSource, useValue: dataSource },
        { provide: EventEmitter2, useValue: events },
        { provide: getRepositoryToken(MapLayer), useValue: layerRepo },
        { provide: getRepositoryToken(MapFeature), useValue: featureRepo },
        { provide: getRepositoryToken(Incident), useValue: incidentRepo },
        { provide: getRepositoryToken(IncidentParticipant), useValue: participantRepo },
        { provide: getRepositoryToken(Task), useValue: taskRepo },
      ],
    }).compile();

    service = moduleRef.get(GisService);
    jest
      .spyOn(moduleRef.get(DatabaseContextService), 'getRepository')
      .mockImplementation((_dataSource, entity) => {
        switch (entity) {
          case MapLayer:
            return layerRepo as any;
          case MapFeature:
            return featureRepo as any;
          case Incident:
            return incidentRepo as any;
          case IncidentParticipant:
            return participantRepo as any;
          case Task:
            return taskRepo as any;
          default:
            throw new Error(`Unexpected entity: ${String(entity)}`);
        }
      });
  });

  it('creates a layer and emits gis.layer.created', async () => {
    incidentRepo.findOne.mockResolvedValue({
      id: 'incident-1',
      commanderId: 'user-1',
      createdBy: 'user-1',
      classification: 3,
    });
    layerRepo.create.mockImplementation((value) => ({ id: 'layer-1', ...value }));
    layerRepo.save.mockResolvedValue({
      id: 'layer-1',
      tenantId: 'tenant-1',
      incidentId: 'incident-1',
      kind: 'RESOURCE',
    });
    layerRepo.findOne.mockResolvedValue({
      id: 'layer-1',
      tenantId: 'tenant-1',
      incidentId: 'incident-1',
      isPublic: false,
      createdBy: 'user-1',
      archivedAt: null,
    });

    const result = await service.createLayer(
      {
        id: 'user-1',
        tenantId: 'tenant-1',
        roles: ['incident_commander'],
        clearance: 3,
        sessionId: 'session-1',
      },
      {
        kind: 'RESOURCE',
        name: 'Layer',
        incidentId: 'incident-1',
      },
    );

    expect(result.id).toBe('layer-1');
    expect(events.emit).toHaveBeenCalledWith(
      'gis.layer.created',
      expect.objectContaining({ layerId: 'layer-1' }),
    );
  });

  it('returns nearby features as FeatureCollection', async () => {
    dataSource.query.mockResolvedValue([
      {
        id: 'feature-1',
        geometry: { type: 'Point', coordinates: [69.24, 41.29] },
        properties: { status: 'active' },
        label: 'Marker',
        linkedIncidentId: null,
        linkedTaskId: null,
        layerId: 'layer-1',
        layerName: 'Resources',
        layerKind: 'RESOURCE',
      },
    ]);

    const result = await service.nearbyFeatures(
      {
        id: 'user-1',
        tenantId: 'tenant-1',
        roles: ['gis_analyst'],
        clearance: 4,
        sessionId: 'session-1',
      },
      { lat: 41.29, lng: 69.24, radius: 1000 },
    );

    expect(result.type).toBe('FeatureCollection');
    expect(result.features).toHaveLength(1);
  });
});
