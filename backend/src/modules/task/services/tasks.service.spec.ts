import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import type { RequestUser } from '../../../shared/auth/current-user.decorator';
import { DatabaseContextService } from '../../../shared/database/database-context.service';
import { User } from '../../iam/entities/user.entity';
import { IncidentParticipant } from '../../incident/entities/incident-participant.entity';
import { Incident } from '../../incident/entities/incident.entity';
import { TaskAssignmentHistory } from '../entities/task-assignment-history.entity';
import { TaskComment } from '../entities/task-comment.entity';
import { Task } from '../entities/task.entity';
import { TasksService } from './tasks.service';

describe('TasksService', () => {
  const actor: RequestUser = {
    id: 'user-1',
    tenantId: 'tenant-1',
    roles: ['incident_commander'],
    permissions: [
      'task.create',
      'task.read',
      'task.assign',
      'task.update',
      'task.update.status',
      'task.comment',
    ],
    clearance: 3,
    sessionId: 'session-1',
  };

  const boardActor: RequestUser = {
    ...actor,
    roles: ['shift_lead'],
  };

  let tasksRepository: any;
  let incidentsRepository: any;
  let usersRepository: any;
  let participantsRepository: any;
  let commentsRepository: any;
  let assignmentHistoryRepository: any;
  let manager: any;
  let dataSource: any;
  let databaseContext: any;
  let events: any;
  let service: TasksService;

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
    creator: null as never,
    parent: null,
    tenant: null as never,
  };

  const makeTask = (overrides: Partial<Task> = {}): Task => ({
    id: 'task-1',
    tenantId: actor.tenantId,
    incidentId: incident.id,
    title: 'Establish water distribution point',
    description: null,
    status: 'todo',
    priority: 1,
    assigneeId: null,
    assignerId: actor.id,
    dueAt: null,
    slaBreachAt: null,
    startedAt: null,
    completedAt: null,
    parentTaskId: null,
    position: 0,
    metadata: {},
    createdBy: actor.id,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    incident,
    assignee: null,
    assigner: null as never,
    parentTask: null,
    creator: null as never,
    tenant: null as never,
    ...overrides,
  });

  const makeQb = (overrides: Record<string, unknown> = {}) => ({
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
    getMany: jest.fn(),
    getCount: jest.fn(),
    getRawOne: jest.fn(),
    ...overrides,
  });

  beforeEach(() => {
    tasksRepository = {
      create: jest.fn((payload) => payload),
      save: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      count: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    incidentsRepository = {
      findOne: jest.fn(),
    };
    usersRepository = {
      findOne: jest.fn(),
    };
    participantsRepository = {
      findOne: jest.fn(),
    };
    commentsRepository = {
      create: jest.fn((payload) => payload),
      save: jest.fn(),
      find: jest.fn(),
      count: jest.fn(),
    };
    assignmentHistoryRepository = {
      create: jest.fn((payload) => payload),
      save: jest.fn(),
      find: jest.fn(),
    };
    manager = {
      getRepository: jest.fn((entity) => {
        if (entity === Task) return tasksRepository;
        if (entity === Incident) return incidentsRepository;
        if (entity === User) return usersRepository;
        if (entity === IncidentParticipant) return participantsRepository;
        if (entity === TaskComment) return commentsRepository;
        if (entity === TaskAssignmentHistory)
          return assignmentHistoryRepository;
        return null;
      }),
    };
    dataSource = {
      manager,
    } as DataSource;
    databaseContext = {
      getRepository: jest.fn((source: DataSource, entity: unknown) => {
        if (entity === Task) return tasksRepository;
        if (entity === Incident) return incidentsRepository;
        if (entity === User) return usersRepository;
        if (entity === IncidentParticipant) return participantsRepository;
        if (entity === TaskComment) return commentsRepository;
        if (entity === TaskAssignmentHistory)
          return assignmentHistoryRepository;
        return null;
      }),
      getManager: jest.fn(() => manager),
    } as unknown as DatabaseContextService;
    events = {
      emit: jest.fn(),
    } as unknown as EventEmitter2;

    service = new TasksService(dataSource, databaseContext, events);
  });

  it('creates task, records initial assignment history, and emits task.created', async () => {
    const dto = {
      title: 'Establish water distribution point',
      incidentId: incident.id,
      assigneeId: 'user-2',
      priority: 1,
    };

    incidentsRepository.findOne.mockResolvedValue(incident);
    usersRepository.findOne.mockResolvedValue({ id: 'user-2' });
    participantsRepository.findOne.mockResolvedValue({
      incidentId: incident.id,
      userId: 'user-2',
      leftAt: null,
    });
    const positionQb = makeQb({
      getRawOne: jest.fn().mockResolvedValue({ maxPosition: '2' }),
    });
    tasksRepository.createQueryBuilder.mockReturnValue(positionQb);
    tasksRepository.save.mockImplementation(async (payload: Task) => ({
      id: 'task-1',
      ...payload,
    }));
    assignmentHistoryRepository.save.mockImplementation(
      async (payload: any) => ({
        id: 'history-1',
        ...payload,
      }),
    );

    jest.spyOn(service, 'findOne').mockResolvedValue({
      ...makeTask({ assigneeId: 'user-2', position: 3 }),
      subtasks: [],
      latestComments: [],
      assignmentHistory: [],
      stats: {
        subtaskCount: 0,
        completedSubtaskCount: 0,
        commentCount: 0,
        dependencyCount: 0,
      },
    } as any);

    const result = await service.create(actor, dto);

    expect(result.status).toBe('todo');
    expect(assignmentHistoryRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-1',
        assigneeId: 'user-2',
      }),
    );
    expect(events.emit).toHaveBeenCalledWith(
      'task.created',
      expect.objectContaining({
        taskId: 'task-1',
        assigneeId: 'user-2',
      }),
    );
  });

  it('updates mutable task fields and emits task.updated', async () => {
    const task = makeTask();
    const lookupQb = makeQb({
      getOne: jest.fn().mockResolvedValue(task),
    });

    manager.getRepository = jest.fn((entity) => {
      if (entity === Task) {
        return {
          createQueryBuilder: jest.fn(() => lookupQb),
          save: jest.fn(async (payload: Task) => payload),
        };
      }
      return null;
    });

    jest.spyOn(service, 'findOne').mockResolvedValue({
      ...task,
      title: 'Updated title',
      priority: 2,
      subtasks: [],
      latestComments: [],
      assignmentHistory: [],
      stats: {
        subtaskCount: 0,
        completedSubtaskCount: 0,
        commentCount: 0,
        dependencyCount: 0,
      },
    } as any);

    const result = await service.update(actor, 'task-1', {
      title: 'Updated title',
      priority: 2,
    });

    expect(result.title).toBe('Updated title');
    expect(events.emit).toHaveBeenCalledWith(
      'task.updated',
      expect.objectContaining({
        taskId: 'task-1',
        changes: expect.objectContaining({
          title: expect.objectContaining({
            before: 'Establish water distribution point',
            after: 'Updated title',
          }),
        }),
      }),
    );
  });

  it('assigns task, records assignment history, and emits task.assigned', async () => {
    const task = makeTask();
    const lookupQb = makeQb({
      getOne: jest.fn().mockResolvedValue(task),
    });

    manager.getRepository = jest.fn((entity) => {
      if (entity === Task) {
        return {
          createQueryBuilder: jest.fn(() => lookupQb),
          save: jest.fn(async (payload: Task) => payload),
        };
      }
      if (entity === User) {
        return usersRepository;
      }
      if (entity === IncidentParticipant) {
        return participantsRepository;
      }
      return null;
    });
    usersRepository.findOne.mockResolvedValue({ id: 'user-2' });
    participantsRepository.findOne.mockResolvedValue({
      incidentId: incident.id,
      userId: 'user-2',
      leftAt: null,
    });
    assignmentHistoryRepository.save.mockImplementation(
      async (payload: any) => ({
        id: 'history-1',
        ...payload,
      }),
    );

    jest.spyOn(service, 'findOne').mockResolvedValue({
      ...task,
      assigneeId: 'user-2',
      subtasks: [],
      latestComments: [],
      assignmentHistory: [],
      stats: {
        subtaskCount: 0,
        completedSubtaskCount: 0,
        commentCount: 0,
        dependencyCount: 0,
      },
    } as any);

    const result = await service.assign(actor, 'task-1', {
      assigneeId: 'user-2',
      reason: 'Field team lead for Sector 4',
    });

    expect(result.assigneeId).toBe('user-2');
    expect(assignmentHistoryRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-1',
        assigneeId: 'user-2',
        reason: 'Field team lead for Sector 4',
      }),
    );
    expect(events.emit).toHaveBeenCalledWith(
      'task.assigned',
      expect.objectContaining({
        taskId: 'task-1',
        newAssigneeId: 'user-2',
      }),
    );
  });

  it('reorders task within its current status lane and emits task.position_changed', async () => {
    const task = makeTask({ id: 'task-2', position: 1, assigneeId: actor.id });
    const lookupQb = makeQb({
      getOne: jest.fn().mockResolvedValue(task),
    });
    const laneTasks = [
      makeTask({ id: 'task-1', position: 0, assigneeId: actor.id }),
      task,
      makeTask({ id: 'task-3', position: 2, assigneeId: actor.id }),
    ];
    const laneQb = makeQb({
      getMany: jest.fn().mockResolvedValue(laneTasks),
    });
    const taskManagerRepository = {
      createQueryBuilder: jest
        .fn()
        .mockReturnValueOnce(lookupQb)
        .mockReturnValueOnce(laneQb),
      save: jest.fn(async (payload: Task[]) => payload),
    };

    manager.getRepository = jest.fn((entity) => {
      if (entity === Task) {
        return taskManagerRepository;
      }
      return null;
    });

    jest.spyOn(service, 'findOne').mockResolvedValue({
      ...task,
      position: 0,
      subtasks: [],
      latestComments: [],
      assignmentHistory: [],
      stats: {
        subtaskCount: 0,
        completedSubtaskCount: 0,
        commentCount: 0,
        dependencyCount: 0,
      },
    } as any);

    const result = await service.updatePosition(actor, 'task-2', {
      position: 0,
    });

    expect(result.position).toBe(0);
    expect(taskManagerRepository.save).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'task-2', position: 0 }),
        expect.objectContaining({ id: 'task-1', position: 1 }),
      ]),
    );
    expect(events.emit).toHaveBeenCalledWith(
      'task.position_changed',
      expect.objectContaining({
        taskId: 'task-2',
        before: 1,
        after: 0,
      }),
    );
  });

  it('starts assigned task and emits status_changed', async () => {
    const task = makeTask({ assigneeId: actor.id });
    const lookupQb = makeQb({
      getOne: jest.fn().mockResolvedValue(task),
    });

    manager.getRepository = jest.fn((entity) => {
      if (entity === Task) {
        return {
          createQueryBuilder: jest.fn(() => lookupQb),
          save: jest.fn(async (payload: Task) => payload),
        };
      }
      return null;
    });

    jest.spyOn(service, 'findOne').mockResolvedValue({
      ...task,
      status: 'in_progress',
      startedAt: new Date('2026-04-13T11:00:00.000Z'),
      subtasks: [],
      latestComments: [],
      assignmentHistory: [],
      stats: {
        subtaskCount: 0,
        completedSubtaskCount: 0,
        commentCount: 0,
        dependencyCount: 0,
      },
    } as any);

    const result = await service.transition(actor, 'task-1', {
      transition: 'start',
    });

    expect(result.status).toBe('in_progress');
    expect(events.emit).toHaveBeenCalledWith(
      'task.status_changed',
      expect.objectContaining({
        taskId: 'task-1',
        before: 'todo',
        after: 'in_progress',
      }),
    );
  });

  it('rejects block transition without reason', async () => {
    const task = makeTask({
      status: 'in_progress',
      assigneeId: actor.id,
      startedAt: new Date(),
    });
    const lookupQb = makeQb({
      getOne: jest.fn().mockResolvedValue(task),
    });

    manager.getRepository = jest.fn((entity) => {
      if (entity === Task) {
        return {
          createQueryBuilder: jest.fn(() => lookupQb),
          save: jest.fn(async (payload: Task) => payload),
        };
      }
      return null;
    });

    await expect(
      service.transition(actor, 'task-1', { transition: 'block' }),
    ).rejects.toThrow('TASK_INVALID_TRANSITION');
  });

  it('blocks completion when direct subtasks remain open', async () => {
    const task = makeTask({
      status: 'in_progress',
      assigneeId: actor.id,
      startedAt: new Date(),
    });
    const lookupQb = makeQb({
      getOne: jest.fn().mockResolvedValue(task),
    });
    const subtaskCountQb = makeQb({
      getCount: jest.fn().mockResolvedValue(1),
    });

    manager.getRepository = jest.fn((entity) => {
      if (entity === Task) {
        return {
          createQueryBuilder: jest.fn(() => lookupQb),
          save: jest.fn(async (payload: Task) => payload),
        };
      }
      return null;
    });
    tasksRepository.createQueryBuilder.mockReturnValue(subtaskCountQb);

    await expect(
      service.transition(actor, 'task-1', { transition: 'complete' }),
    ).rejects.toThrow('TASK_SUBTASKS_INCOMPLETE');
  });

  it('adds comment and emits task.commented', async () => {
    const task = makeTask();
    const lookupQb = makeQb({
      getOne: jest.fn().mockResolvedValue(task),
    });

    tasksRepository.createQueryBuilder.mockReturnValue(lookupQb);
    commentsRepository.save.mockImplementation(async (payload: any) => ({
      id: 'comment-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...payload,
    }));

    const result = await service.addComment(actor, 'task-1', {
      body: 'Water tankers arrived at the site.',
    });

    expect(result.id).toBe('comment-1');
    expect(events.emit).toHaveBeenCalledWith(
      'task.commented',
      expect.objectContaining({
        taskId: 'task-1',
        commentId: 'comment-1',
      }),
    );
  });

  it('groups tasks into board columns', async () => {
    const boardQb = makeQb({
      getMany: jest
        .fn()
        .mockResolvedValue([
          makeTask({ id: 'task-todo', status: 'todo' }),
          makeTask({ id: 'task-blocked', status: 'blocked' }),
        ]),
    });
    tasksRepository.createQueryBuilder.mockReturnValue(boardQb);

    const result = await service.getBoard(boardActor, {});

    expect(result.todo).toHaveLength(1);
    expect(result.blocked).toHaveLength(1);
    expect(result.inProgress).toHaveLength(0);
  });

  it('lists overdue tasks ordered by due date', async () => {
    const overdueTask = makeTask({
      id: 'task-overdue',
      dueAt: new Date('2026-04-13T08:00:00.000Z'),
      status: 'in_progress',
    });
    const overdueQb = makeQb({
      getMany: jest.fn().mockResolvedValue([overdueTask]),
    });
    tasksRepository.createQueryBuilder.mockReturnValue(overdueQb);

    const result = await service.getOverdueTasks(boardActor, {});

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('task-overdue');
  });
});
