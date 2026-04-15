import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DatabaseContextService } from '../../../shared/database/database-context.service';
import { User } from '../../iam/entities/user.entity';
import { IncidentParticipant } from '../../incident/entities/incident-participant.entity';
import { Incident } from '../../incident/entities/incident.entity';
import { Task } from '../../task/entities/task.entity';
import { NotificationPreference } from '../entities/notification-preference.entity';
import { NotificationEntity } from '../entities/notification.entity';
import { EmailService } from './email.service';
import { InAppService } from './in-app.service';
import { NotificationService } from './notification.service';

function createRepo() {
  return {
    createQueryBuilder: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((value) => value),
  };
}

describe('NotificationService', () => {
  let service: NotificationService;
  const notificationRepo = createRepo();
  const preferenceRepo = createRepo();
  const userRepo = createRepo();
  const incidentRepo = createRepo();
  const participantRepo = createRepo();
  const taskRepo = createRepo();
  const inApp = { deliver: jest.fn() };
  const email = { queue: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationService,
        DatabaseContextService,
        { provide: DataSource, useValue: {} },
        { provide: InAppService, useValue: inApp },
        { provide: EmailService, useValue: email },
        {
          provide: getRepositoryToken(NotificationEntity),
          useValue: notificationRepo,
        },
        {
          provide: getRepositoryToken(NotificationPreference),
          useValue: preferenceRepo,
        },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Incident), useValue: incidentRepo },
        {
          provide: getRepositoryToken(IncidentParticipant),
          useValue: participantRepo,
        },
        { provide: getRepositoryToken(Task), useValue: taskRepo },
      ],
    }).compile();

    service = moduleRef.get(NotificationService);
    jest
      .spyOn(moduleRef.get(DatabaseContextService), 'getRepository')
      .mockImplementation((_dataSource, entity) => {
        switch (entity) {
          case NotificationEntity:
            return notificationRepo as any;
          case NotificationPreference:
            return preferenceRepo as any;
          case User:
            return userRepo as any;
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

  it('dispatches in-app and email notifications when recipient is enabled', async () => {
    userRepo.find.mockResolvedValue([{ id: 'user-2', tenantId: 'tenant-1' }]);
    notificationRepo.createQueryBuilder.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getExists: jest.fn().mockResolvedValue(false),
    });
    preferenceRepo.findOne.mockResolvedValue({
      userId: 'user-2',
      tenantId: 'tenant-1',
      isDisabled: false,
      emailEnabled: true,
      pushEnabled: false,
      inAppEnabled: true,
      eventOverrides: {},
    });
    notificationRepo.save.mockResolvedValue({
      id: 'notif-1',
      userId: 'user-2',
      eventType: 'incident.status_changed',
    });

    const result = await service.dispatch({
      tenantId: 'tenant-1',
      eventType: 'incident.status_changed',
      title: 'Incident status updated',
      body: 'Incident moved to open.',
      recipientIds: ['user-2'],
    });

    expect(result).toHaveLength(1);
    expect(inApp.deliver).toHaveBeenCalledTimes(1);
    expect(email.queue).toHaveBeenCalledTimes(1);
  });

  it('bypasses disabled preferences for critical severity', async () => {
    userRepo.find.mockResolvedValue([{ id: 'user-2', tenantId: 'tenant-1' }]);
    notificationRepo.createQueryBuilder.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getExists: jest.fn().mockResolvedValue(false),
    });
    preferenceRepo.findOne.mockResolvedValue({
      userId: 'user-2',
      tenantId: 'tenant-1',
      isDisabled: true,
      emailEnabled: false,
      pushEnabled: false,
      inAppEnabled: false,
      eventOverrides: {},
    });
    notificationRepo.save.mockResolvedValue({
      id: 'notif-2',
      userId: 'user-2',
      eventType: 'incident.severity_changed',
    });

    const result = await service.dispatch({
      tenantId: 'tenant-1',
      eventType: 'incident.severity_changed',
      title: 'Incident severity changed',
      body: 'Severity increased.',
      recipientIds: ['user-2'],
      severity: 4,
    });

    expect(result).toHaveLength(1);
    expect(inApp.deliver).toHaveBeenCalledTimes(1);
    expect(email.queue).toHaveBeenCalledTimes(1);
  });
});
