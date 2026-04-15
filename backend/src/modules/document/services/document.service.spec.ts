import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { DatabaseContextService } from '../../../shared/database/database-context.service';
import { MinioService } from '../../file/services/minio.service';
import { Role } from '../../iam/entities/role.entity';
import { UserRole } from '../../iam/entities/user-role.entity';
import { User } from '../../iam/entities/user.entity';
import { IncidentParticipant } from '../../incident/entities/incident-participant.entity';
import { Incident } from '../../incident/entities/incident.entity';
import { DocumentApproval } from '../entities/document-approval.entity';
import { DocumentEntity } from '../entities/document.entity';
import { DocumentVersion } from '../entities/document-version.entity';
import { DocumentService } from './document.service';
import { PdfRenderService } from './pdf-render.service';

function createRepo() {
  return {
    createQueryBuilder: jest.fn(),
    count: jest.fn(),
    create: jest.fn((value) => value),
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
  };
}

describe('DocumentService', () => {
  let service: DocumentService;
  const documentRepo = createRepo();
  const versionRepo = createRepo();
  const approvalRepo = createRepo();
  const incidentRepo = createRepo();
  const participantRepo = createRepo();
  const userRepo = createRepo();
  const userRoleRepo = createRepo();
  const roleRepo = createRepo();
  const minio = { putObject: jest.fn(), presignedGetUrl: jest.fn() };
  const config = { get: jest.fn((_k: string, v: string) => v) };
  const renderer = { renderFromTemplate: jest.fn() };
  const events = { emit: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        DocumentService,
        DatabaseContextService,
        { provide: DataSource, useValue: {} },
        { provide: MinioService, useValue: minio },
        { provide: ConfigService, useValue: config },
        { provide: PdfRenderService, useValue: renderer },
        { provide: EventEmitter2, useValue: events },
        { provide: getRepositoryToken(DocumentEntity), useValue: documentRepo },
        { provide: getRepositoryToken(DocumentVersion), useValue: versionRepo },
        { provide: getRepositoryToken(DocumentApproval), useValue: approvalRepo },
        { provide: getRepositoryToken(Incident), useValue: incidentRepo },
        { provide: getRepositoryToken(IncidentParticipant), useValue: participantRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(UserRole), useValue: userRoleRepo },
        { provide: getRepositoryToken(Role), useValue: roleRepo },
      ],
    }).compile();

    service = moduleRef.get(DocumentService);
    jest
      .spyOn(moduleRef.get(DatabaseContextService), 'getRepository')
      .mockImplementation((_dataSource, entity) => {
        switch (entity) {
          case DocumentEntity:
            return documentRepo as any;
          case DocumentVersion:
            return versionRepo as any;
          case DocumentApproval:
            return approvalRepo as any;
          case Incident:
            return incidentRepo as any;
          case IncidentParticipant:
            return participantRepo as any;
          case User:
            return userRepo as any;
          case UserRole:
            return userRoleRepo as any;
          case Role:
            return roleRepo as any;
          default:
            throw new Error(`Unexpected entity: ${String(entity)}`);
        }
      });
  });

  it('creates document, renders first version, and emits events', async () => {
    incidentRepo.findOne.mockResolvedValue({
      id: 'incident-1',
      classification: 2,
      commanderId: 'user-1',
      createdBy: 'user-1',
    });
    documentRepo.create.mockImplementation((value) => ({ id: 'doc-1', ...value }));
    documentRepo.save
      .mockResolvedValueOnce({
        id: 'doc-1',
        tenantId: 'tenant-1',
        incidentId: 'incident-1',
        title: 'Report',
        templateCode: 'initial-report',
        classification: 2,
        lifecycleState: 'DRAFT',
        currentVersionId: null,
        createdBy: 'user-1',
        metadata: {},
      })
      .mockResolvedValueOnce({
        id: 'doc-1',
        tenantId: 'tenant-1',
        incidentId: 'incident-1',
        title: 'Report',
        templateCode: 'initial-report',
        classification: 2,
        lifecycleState: 'DRAFT',
        currentVersionId: 'ver-1',
        createdBy: 'user-1',
        metadata: {},
      });
    renderer.renderFromTemplate.mockResolvedValue(Buffer.from('pdf'));
    versionRepo.count.mockResolvedValue(0);
    versionRepo.create.mockImplementation((value) => ({ id: 'ver-1', ...value }));
    versionRepo.save.mockResolvedValue({ id: 'ver-1' });
    documentRepo.createQueryBuilder.mockReturnValue({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({
        id: 'doc-1',
        tenantId: 'tenant-1',
        incidentId: 'incident-1',
        title: 'Report',
        templateCode: 'initial-report',
        classification: 2,
        lifecycleState: 'DRAFT',
        currentVersionId: 'ver-1',
        createdBy: 'user-1',
      }),
    });
    versionRepo.find.mockResolvedValue([{ id: 'ver-1', versionNumber: 1 }]);
    approvalRepo.find.mockResolvedValue([]);

    const result = await service.create(
      {
        id: 'user-1',
        tenantId: 'tenant-1',
        roles: ['incident_commander'],
        clearance: 3,
        sessionId: 'session-1',
      },
      { title: 'Report', templateCode: 'initial-report', incidentId: 'incident-1' },
    );

    expect(result.id).toBe('doc-1');
    expect(minio.putObject).toHaveBeenCalled();
    expect(events.emit).toHaveBeenCalledWith(
      'document.created',
      expect.objectContaining({ documentId: 'doc-1' }),
    );
  });

  it('publishes approved document when all approvals are complete', async () => {
    documentRepo.createQueryBuilder.mockReturnValue({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({
        id: 'doc-1',
        tenantId: 'tenant-1',
        incidentId: null,
        title: 'Order',
        templateCode: 'evacuation-order',
        classification: 1,
        lifecycleState: 'APPROVED',
        currentVersionId: 'ver-1',
        createdBy: 'user-1',
      }),
    });
    approvalRepo.count.mockResolvedValue(0);
    documentRepo.save.mockResolvedValue({
      id: 'doc-1',
      lifecycleState: 'PUBLISHED',
    });
    versionRepo.find.mockResolvedValue([{ id: 'ver-1', versionNumber: 1 }]);
    approvalRepo.find.mockResolvedValue([]);

    const result = await service.publish(
      {
        id: 'user-1',
        tenantId: 'tenant-1',
        roles: ['incident_commander'],
        clearance: 3,
        sessionId: 'session-1',
      },
      'doc-1',
    );

    expect(result.lifecycleState).toBe('PUBLISHED');
    expect(events.emit).toHaveBeenCalledWith(
      'document.published',
      expect.objectContaining({ documentId: 'doc-1' }),
    );
  });
});
