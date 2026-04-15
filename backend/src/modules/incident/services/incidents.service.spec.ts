import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { Brackets } from 'typeorm';
import type { RequestUser } from '../../../shared/auth/current-user.decorator';
import { DatabaseContextService } from '../../../shared/database/database-context.service';
import { User } from '../../iam/entities/user.entity';
import { Task } from '../../task/entities/task.entity';
import { IncidentParticipant } from '../entities/incident-participant.entity';
import { ChangeSeverityDto } from '../dto/change-severity.dto';
import { CreateIncidentDto } from '../dto/create-incident.dto';
import { IncidentTimelineEntry } from '../entities/incident-timeline-entry.entity';
import { Incident } from '../entities/incident.entity';
import { SituationReport } from '../entities/situation-report.entity';
import { IncidentsService } from './incidents.service';

describe('IncidentsService', () => {
  const actor: RequestUser = {
    id: 'user-1',
    tenantId: 'tenant-1',
    roles: ['incident_commander'],
    permissions: ['incident.create', 'incident.read', 'incident.update.status'],
    clearance: 3,
    sessionId: 'session-1',
  };

  let incidentsRepository: any;
  let usersRepository: any;
  let participantsRepository: any;
  let tasksRepository: any;
  let sitrepsRepository: any;
  let timelineRepository: any;
  let manager: any;
  let dataSource: any;
  let databaseContext: any;
  let events: any;
  let service: IncidentsService;

  beforeEach(() => {
    incidentsRepository = {
      create: jest.fn((payload) => payload),
      save: jest.fn(),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    usersRepository = {
      findOne: jest.fn(),
    };
    participantsRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((payload) => payload),
      save: jest.fn(async (payload) => payload),
    };
    tasksRepository = {
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn(),
    };
    sitrepsRepository = {
      create: jest.fn((payload) => payload),
      save: jest.fn(async (payload) => ({
        id: payload.id ?? 'sitrep-1',
        reportedAt: payload.reportedAt ?? new Date('2026-04-13T13:00:00.000Z'),
        ...payload,
      })),
      createQueryBuilder: jest.fn(),
    };
    timelineRepository = {
      create: jest.fn((payload) => payload),
      save: jest.fn(async (payload) => ({
        id: payload.id ?? 'timeline-1',
        ts: payload.ts ?? new Date('2026-04-13T12:00:00.000Z'),
        ...payload,
      })),
      createQueryBuilder: jest.fn(),
    };
    manager = {
      getRepository: jest.fn((entity) => {
        if (entity === Incident) return incidentsRepository;
        if (entity === IncidentParticipant) return participantsRepository;
        if (entity === Task) return tasksRepository;
        if (entity === SituationReport) return sitrepsRepository;
        if (entity === IncidentTimelineEntry) return timelineRepository;
        if (entity === User) return usersRepository;
        return null;
      }),
    };
    dataSource = {
      manager,
    } as DataSource;
    databaseContext = {
      getRepository: jest.fn((source: DataSource, entity: unknown) => {
        if (entity === Incident) return incidentsRepository;
        if (entity === IncidentParticipant) return participantsRepository;
        if (entity === Task) return tasksRepository;
        if (entity === SituationReport) return sitrepsRepository;
        if (entity === IncidentTimelineEntry) return timelineRepository;
        if (entity === User) return usersRepository;
        return null;
      }),
      getManager: jest.fn(() => manager),
    } as unknown as DatabaseContextService;
    events = {
      emit: jest.fn(),
    } as unknown as EventEmitter2;

    service = new IncidentsService(dataSource, databaseContext, events);
  });

  it('creates incident draft and initial timeline entry', async () => {
    const dto: CreateIncidentDto = {
      title: 'Flood in district center',
      category: 'flood',
      severity: 2,
    };

    usersRepository.findOne.mockResolvedValue(null);
    incidentsRepository.createQueryBuilder.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    });
    incidentsRepository.findOne.mockResolvedValue(null);
    incidentsRepository.save.mockImplementation(async (payload: Incident) => ({
      id: 'incident-1',
      ...payload,
    }));

    jest.spyOn(service, 'findOne').mockResolvedValue({
      id: 'incident-1',
      tenantId: actor.tenantId,
      code: 'FL-2026-04-0001',
      title: dto.title,
      description: null,
      category: dto.category,
      severity: dto.severity,
      status: 'draft',
      classification: 1,
      commanderId: null,
      openedAt: null,
      closedAt: null,
      parentId: null,
      metadata: {},
      createdBy: actor.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Incident);

    const result = await service.create(actor, dto);

    expect(result.status).toBe('draft');
    expect(timelineRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        incidentId: 'incident-1',
        kind: 'status_change',
        payload: { after: 'draft' },
      }),
    );
  });

  it('applies search filter when listing incidents', async () => {
    const qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    incidentsRepository.createQueryBuilder.mockReturnValue(qb);

    await service.findAll(actor, { q: 'flood' });

    expect(qb.andWhere).toHaveBeenCalledWith(expect.any(Brackets));
  });

  it('applies requested sort preset when listing incidents', async () => {
    const qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    incidentsRepository.createQueryBuilder.mockReturnValue(qb);

    await service.findAll(actor, { sort: 'severity_desc' });

    expect(qb.orderBy).toHaveBeenCalledWith('incident.severity', 'DESC');
    expect(qb.addOrderBy).toHaveBeenCalledWith('incident.updatedAt', 'DESC');
  });

  it('transitions incident and records status timeline entry', async () => {
    const incident: Incident = {
      id: 'incident-1',
      tenantId: actor.tenantId,
      code: 'FL-2026-04-0001',
      title: 'Flood in district center',
      description: null,
      category: 'flood',
      severity: 2,
      status: 'open',
      classification: 1,
      commanderId: actor.id,
      openedAt: new Date('2026-04-13T10:00:00.000Z'),
      closedAt: null,
      parentId: null,
      metadata: {},
      createdBy: actor.id,
      createdAt: new Date(),
      updatedAt: new Date(),
      commander: null,
      parent: null,
      creator: null as never,
      tenant: null as never,
    };

    manager.getRepository = jest.fn(() => ({
      createQueryBuilder: jest.fn(() => ({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        setLock: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(incident),
      })),
      save: jest.fn(async (payload: Incident) => payload),
    }));

    jest.spyOn(service, 'findOne').mockResolvedValue({
      ...incident,
      status: 'escalated',
    });

    const result = await service.transition(actor, 'incident-1', {
      transition: 'escalate',
      reason: 'Water level is rising fast',
    });

    expect(result.status).toBe('escalated');
    expect(timelineRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        incidentId: 'incident-1',
        kind: 'escalation',
        payload: expect.objectContaining({
          before: 'open',
          after: 'escalated',
          reason: 'Water level is rising fast',
        }),
      }),
    );
  });

  it('blocks incident close when open tasks remain', async () => {
    const incident: Incident = {
      id: 'incident-1',
      tenantId: actor.tenantId,
      code: 'FL-2026-04-0001',
      title: 'Flood in district center',
      description: null,
      category: 'flood',
      severity: 2,
      status: 'contained',
      classification: 1,
      commanderId: actor.id,
      openedAt: new Date('2026-04-13T10:00:00.000Z'),
      closedAt: null,
      parentId: null,
      metadata: {},
      createdBy: actor.id,
      createdAt: new Date(),
      updatedAt: new Date(),
      commander: null,
      parent: null,
      creator: null as never,
      tenant: null as never,
    };

    manager.getRepository = jest.fn(() => ({
      createQueryBuilder: jest.fn(() => ({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        setLock: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(incident),
      })),
      save: jest.fn(async (payload: Incident) => payload),
    }));
    tasksRepository.count.mockResolvedValue(1);
    tasksRepository.createQueryBuilder.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(1),
    });

    await expect(
      service.transition(actor, 'incident-1', {
        transition: 'close',
        resolutionSummary: 'Trying to close too early',
      }),
    ).rejects.toThrow('INCIDENT_OPEN_TASKS_REMAIN');
  });

  it('changes severity and records severity timeline entry', async () => {
    const incident: Incident = {
      id: 'incident-1',
      tenantId: actor.tenantId,
      code: 'FL-2026-04-0001',
      title: 'Flood in district center',
      description: null,
      category: 'flood',
      severity: 2,
      status: 'open',
      classification: 1,
      commanderId: actor.id,
      openedAt: new Date('2026-04-13T10:00:00.000Z'),
      closedAt: null,
      parentId: null,
      metadata: {},
      createdBy: actor.id,
      createdAt: new Date(),
      updatedAt: new Date(),
      commander: null,
      parent: null,
      creator: null as never,
      tenant: null as never,
    };

    manager.getRepository = jest.fn(() => ({
      createQueryBuilder: jest.fn(() => ({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        setLock: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(incident),
      })),
      save: jest.fn(async (payload: Incident) => payload),
    }));

    jest.spyOn(service, 'findOne').mockResolvedValue({
      ...incident,
      severity: 4,
    });

    const result = await service.changeSeverity(actor, 'incident-1', {
      severity: 4,
      reason: 'Floodwater reached critical infrastructure',
    } satisfies ChangeSeverityDto);

    expect(result.severity).toBe(4);
    expect(timelineRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        incidentId: 'incident-1',
        kind: 'severity_change',
        payload: {
          before: 2,
          after: 4,
          reason: 'Floodwater reached critical infrastructure',
        },
      }),
    );
  });

  it('assigns commander and records commander timeline entry', async () => {
    const incident: Incident = {
      id: 'incident-1',
      tenantId: actor.tenantId,
      code: 'FL-2026-04-0001',
      title: 'Flood in district center',
      description: null,
      category: 'flood',
      severity: 2,
      status: 'open',
      classification: 1,
      commanderId: null,
      openedAt: new Date('2026-04-13T10:00:00.000Z'),
      closedAt: null,
      parentId: null,
      metadata: {},
      createdBy: actor.id,
      createdAt: new Date(),
      updatedAt: new Date(),
      commander: null,
      parent: null,
      creator: null as never,
      tenant: null as never,
    };

    manager.getRepository = jest.fn((entity) => {
      if (entity === Incident) {
        return {
          createQueryBuilder: jest.fn(() => ({
            leftJoinAndSelect: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            setLock: jest.fn().mockReturnThis(),
            getOne: jest.fn().mockResolvedValue(incident),
          })),
          save: jest.fn(async (payload: Incident) => payload),
        };
      }

      if (entity === IncidentParticipant) {
        return participantsRepository;
      }

      return null;
    });
    usersRepository.findOne.mockResolvedValue({ id: 'user-2' });
    participantsRepository.findOne.mockResolvedValue(null);

    jest.spyOn(service, 'findOne').mockResolvedValue({
      ...incident,
      commanderId: 'user-2',
    });

    const result = await service.assignCommander(actor, 'incident-1', 'user-2');

    expect(result.commanderId).toBe('user-2');
    expect(timelineRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        incidentId: 'incident-1',
        kind: 'commander_assigned',
        payload: {
          previousCommanderId: null,
          newCommanderId: 'user-2',
        },
      }),
    );
  });

  it('adds participant and records participant_joined timeline entry', async () => {
    const incident: Incident = {
      id: 'incident-1',
      tenantId: actor.tenantId,
      code: 'FL-2026-04-0001',
      title: 'Flood in district center',
      description: null,
      category: 'flood',
      severity: 2,
      status: 'open',
      classification: 1,
      commanderId: actor.id,
      openedAt: new Date('2026-04-13T10:00:00.000Z'),
      closedAt: null,
      parentId: null,
      metadata: {},
      createdBy: actor.id,
      createdAt: new Date(),
      updatedAt: new Date(),
      commander: null,
      parent: null,
      creator: null as never,
      tenant: null as never,
    };

    manager.getRepository = jest.fn((entity) => {
      if (entity === Incident) {
        return {
          createQueryBuilder: jest.fn(() => ({
            leftJoinAndSelect: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            setLock: jest.fn().mockReturnThis(),
            getOne: jest.fn().mockResolvedValue(incident),
          })),
          save: jest.fn(async (payload: Incident) => payload),
        };
      }

      if (entity === IncidentParticipant) {
        return participantsRepository;
      }

      return null;
    });
    usersRepository.findOne.mockResolvedValue({ id: 'user-3' });
    participantsRepository.findOne.mockResolvedValue(null);

    const participant = await service.addParticipant(
      actor,
      'incident-1',
      'user-3',
      'responder',
    );

    expect(participant.roleInIncident).toBe('responder');
    expect(timelineRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'participant_joined',
        payload: {
          userId: 'user-3',
          role: 'responder',
        },
      }),
    );
  });

  it('removes participant and records participant_left timeline entry', async () => {
    const incident: Incident = {
      id: 'incident-1',
      tenantId: actor.tenantId,
      code: 'FL-2026-04-0001',
      title: 'Flood in district center',
      description: null,
      category: 'flood',
      severity: 2,
      status: 'open',
      classification: 1,
      commanderId: actor.id,
      openedAt: new Date('2026-04-13T10:00:00.000Z'),
      closedAt: null,
      parentId: null,
      metadata: {},
      createdBy: actor.id,
      createdAt: new Date(),
      updatedAt: new Date(),
      commander: null,
      parent: null,
      creator: null as never,
      tenant: null as never,
    };
    const participant = {
      incidentId: 'incident-1',
      userId: 'user-3',
      roleInIncident: 'responder',
      leftAt: null,
    };

    manager.getRepository = jest.fn((entity) => {
      if (entity === Incident) {
        return {
          createQueryBuilder: jest.fn(() => ({
            leftJoinAndSelect: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            setLock: jest.fn().mockReturnThis(),
            getOne: jest.fn().mockResolvedValue(incident),
          })),
          save: jest.fn(async (payload: Incident) => payload),
        };
      }

      if (entity === IncidentParticipant) {
        return participantsRepository;
      }

      return null;
    });
    participantsRepository.findOne.mockResolvedValue(participant);

    await service.removeParticipant(actor, 'incident-1', 'user-3');

    expect(participantsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-3',
      }),
    );
    expect(timelineRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'participant_left',
        payload: {
          userId: 'user-3',
          role: 'responder',
        },
      }),
    );
  });

  it('submits sitrep for active participant and records sitrep timeline entry', async () => {
    const incident: Incident = {
      id: 'incident-1',
      tenantId: actor.tenantId,
      code: 'FL-2026-04-0001',
      title: 'Flood in district center',
      description: null,
      category: 'flood',
      severity: 2,
      status: 'open',
      classification: 1,
      commanderId: actor.id,
      openedAt: new Date('2026-04-13T10:00:00.000Z'),
      closedAt: null,
      parentId: null,
      metadata: {},
      createdBy: actor.id,
      createdAt: new Date(),
      updatedAt: new Date(),
      commander: null,
      parent: null,
      creator: null as never,
      tenant: null as never,
    };

    manager.getRepository = jest.fn((entity) => {
      if (entity === Incident) {
        return {
          createQueryBuilder: jest.fn(() => ({
            leftJoinAndSelect: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            setLock: jest.fn().mockReturnThis(),
            getOne: jest.fn().mockResolvedValue(incident),
          })),
          save: jest.fn(async (payload: Incident) => payload),
        };
      }
      if (entity === IncidentParticipant) {
        return participantsRepository;
      }
      if (entity === SituationReport) {
        return sitrepsRepository;
      }
      return null;
    });
    participantsRepository.findOne.mockResolvedValue({
      incidentId: 'incident-1',
      userId: actor.id,
      roleInIncident: 'commander',
      leftAt: null,
    });

    const sitrep = await service.submitSitrep(actor, 'incident-1', {
      text: 'Sector B evacuation has started.',
      severity: 3,
      attachments: ['550e8400-e29b-41d4-a716-446655440000'],
    });

    expect(sitrep.id).toBe('sitrep-1');
    expect(timelineRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'sitrep',
        payload: {
          sitrepId: 'sitrep-1',
          severity: 3,
        },
      }),
    );
  });

  it('rejects sitrep submission for non-participant', async () => {
    const incident: Incident = {
      id: 'incident-1',
      tenantId: actor.tenantId,
      code: 'FL-2026-04-0001',
      title: 'Flood in district center',
      description: null,
      category: 'flood',
      severity: 2,
      status: 'open',
      classification: 1,
      commanderId: actor.id,
      openedAt: new Date('2026-04-13T10:00:00.000Z'),
      closedAt: null,
      parentId: null,
      metadata: {},
      createdBy: actor.id,
      createdAt: new Date(),
      updatedAt: new Date(),
      commander: null,
      parent: null,
      creator: null as never,
      tenant: null as never,
    };

    manager.getRepository = jest.fn((entity) => {
      if (entity === Incident) {
        return {
          createQueryBuilder: jest.fn(() => ({
            leftJoinAndSelect: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            setLock: jest.fn().mockReturnThis(),
            getOne: jest.fn().mockResolvedValue(incident),
          })),
        };
      }
      if (entity === IncidentParticipant) {
        return participantsRepository;
      }
      if (entity === SituationReport) {
        return sitrepsRepository;
      }
      return null;
    });
    participantsRepository.findOne.mockResolvedValue(null);

    await expect(
      service.submitSitrep(actor, 'incident-1', {
        text: 'Attempted sitrep.',
      }),
    ).rejects.toThrow('INCIDENT_PARTICIPANT_REQUIRED');
  });
});
