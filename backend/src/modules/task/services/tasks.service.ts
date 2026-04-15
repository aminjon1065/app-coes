import {
  Brackets,
  DataSource,
  IsNull,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestUser } from '../../../shared/auth/current-user.decorator';
import { DatabaseContextService } from '../../../shared/database/database-context.service';
import { User } from '../../iam/entities/user.entity';
import { IncidentParticipant } from '../../incident/entities/incident-participant.entity';
import { Incident } from '../../incident/entities/incident.entity';
import { AddTaskCommentDto } from '../dto/add-task-comment.dto';
import { AssignTaskDto } from '../dto/assign-task.dto';
import { CreateTaskDto } from '../dto/create-task.dto';
import { ListOverdueTasksDto } from '../dto/list-overdue-tasks.dto';
import { ListTaskCommentsDto } from '../dto/list-task-comments.dto';
import { ListTasksDto } from '../dto/list-tasks.dto';
import { TaskBoardDto } from '../dto/task-board.dto';
import {
  TASK_TRANSITIONS,
  TransitionTaskStatusDto,
} from '../dto/transition-task-status.dto';
import { UpdateTaskDto } from '../dto/update-task.dto';
import { UpdateTaskPositionDto } from '../dto/update-task-position.dto';
import { TaskAssignmentHistory } from '../entities/task-assignment-history.entity';
import { TaskComment } from '../entities/task-comment.entity';
import { Task, TaskStatus } from '../entities/task.entity';

type AvailableTransition = {
  code: (typeof TASK_TRANSITIONS)[number];
  label: string;
  requires: string[];
};

type TaskChangeSet = Record<string, { before: unknown; after: unknown }>;

type TaskDetail = Task & {
  subtasks: Task[];
  latestComments: TaskComment[];
  assignmentHistory: TaskAssignmentHistory[];
  stats: {
    subtaskCount: number;
    completedSubtaskCount: number;
    commentCount: number;
    dependencyCount: number;
  };
};

type TaskBoard = {
  todo: Task[];
  inProgress: Task[];
  blocked: Task[];
  review: Task[];
  done: Task[];
  cancelled: Task[];
};

@Injectable()
export class TasksService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly databaseContext: DatabaseContextService,
    private readonly events: EventEmitter2,
  ) {}

  private get tasks(): Repository<Task> {
    return this.databaseContext.getRepository(this.dataSource, Task);
  }

  private get incidents(): Repository<Incident> {
    return this.databaseContext.getRepository(this.dataSource, Incident);
  }

  private get users(): Repository<User> {
    return this.databaseContext.getRepository(this.dataSource, User);
  }

  private get participants(): Repository<IncidentParticipant> {
    return this.databaseContext.getRepository(
      this.dataSource,
      IncidentParticipant,
    );
  }

  private get comments(): Repository<TaskComment> {
    return this.databaseContext.getRepository(this.dataSource, TaskComment);
  }

  private get assignmentHistory(): Repository<TaskAssignmentHistory> {
    return this.databaseContext.getRepository(
      this.dataSource,
      TaskAssignmentHistory,
    );
  }

  async create(actor: RequestUser, dto: CreateTaskDto): Promise<TaskDetail> {
    const parentTask = await this.ensureParentTask(
      actor.tenantId,
      dto.parentTaskId,
    );
    const incidentId = parentTask?.incidentId ?? dto.incidentId ?? null;

    if (
      parentTask &&
      dto.incidentId &&
      parentTask.incidentId !== dto.incidentId
    ) {
      throw new UnprocessableEntityException('TASK_PARENT_INCIDENT_MISMATCH');
    }

    const incident = incidentId
      ? await this.loadIncident(actor.tenantId, incidentId)
      : null;

    if (incident) {
      this.assertIncidentVisible(actor, incident);
      if (!this.canManageIncidentTasks(actor, incident)) {
        throw new ForbiddenException('TASK_CREATE_FORBIDDEN');
      }
      if (incident.status === 'closed' || incident.status === 'archived') {
        throw new ConflictException('INCIDENT_CLOSED');
      }
    } else if (!this.canManageStandaloneTasks(actor)) {
      throw new ForbiddenException('TASK_CREATE_FORBIDDEN');
    }

    if (dto.assigneeId) {
      await this.ensureAssignableUser(actor.tenantId, dto.assigneeId, incident);
    }

    const position = await this.getNextPosition(
      actor.tenantId,
      incidentId,
      'todo',
      parentTask?.id ?? null,
    );

    const task = this.tasks.create({
      tenantId: actor.tenantId,
      incidentId,
      title: dto.title.trim(),
      description: dto.description?.trim() ?? null,
      status: 'todo',
      priority: dto.priority ?? 3,
      assigneeId: dto.assigneeId ?? null,
      assignerId: actor.id,
      dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
      slaBreachAt: dto.slaBreachAt ? new Date(dto.slaBreachAt) : null,
      startedAt: null,
      completedAt: null,
      parentTaskId: parentTask?.id ?? null,
      position,
      metadata: dto.metadata ?? {},
      createdBy: actor.id,
    });

    const saved = await this.tasks.save(task);
    if (saved.assigneeId) {
      await this.recordAssignment(saved, actor.id, saved.assigneeId, null);
    }

    this.events.emit('task.created', {
      taskId: saved.id,
      tenantId: saved.tenantId,
      incidentId: saved.incidentId,
      actorId: actor.id,
      assigneeId: saved.assigneeId,
      priority: saved.priority,
    });

    return this.findOne(actor, saved.id);
  }

  async update(
    actor: RequestUser,
    taskId: string,
    dto: UpdateTaskDto,
  ): Promise<TaskDetail> {
    const manager =
      this.databaseContext.getManager() ?? this.dataSource.manager;
    const task = await this.findVisibleTask(actor, taskId, {
      repository: manager.getRepository(Task),
      forUpdate: true,
    });

    this.assertMutable(task);
    if (!this.canEditTask(actor, task)) {
      throw new ForbiddenException('TASK_UPDATE_FORBIDDEN');
    }

    const changes: TaskChangeSet = {};

    if (Object.prototype.hasOwnProperty.call(dto, 'title')) {
      const nextTitle = dto.title?.trim();
      if (nextTitle && nextTitle !== task.title) {
        changes.title = { before: task.title, after: nextTitle };
        task.title = nextTitle;
      }
    }

    if (Object.prototype.hasOwnProperty.call(dto, 'description')) {
      const nextDescription = dto.description?.trim() ?? null;
      if (nextDescription !== task.description) {
        changes.description = {
          before: task.description,
          after: nextDescription,
        };
        task.description = nextDescription;
      }
    }

    if (
      Object.prototype.hasOwnProperty.call(dto, 'priority') &&
      dto.priority !== undefined &&
      dto.priority !== task.priority
    ) {
      changes.priority = { before: task.priority, after: dto.priority };
      task.priority = dto.priority;
    }

    if (Object.prototype.hasOwnProperty.call(dto, 'dueAt')) {
      const nextDueAt = dto.dueAt ? new Date(dto.dueAt) : null;
      if (!this.sameDate(task.dueAt, nextDueAt)) {
        changes.dueAt = {
          before: task.dueAt?.toISOString() ?? null,
          after: nextDueAt?.toISOString() ?? null,
        };
        task.dueAt = nextDueAt;
      }
    }

    if (Object.prototype.hasOwnProperty.call(dto, 'slaBreachAt')) {
      const nextSlaBreachAt = dto.slaBreachAt
        ? new Date(dto.slaBreachAt)
        : null;
      if (!this.sameDate(task.slaBreachAt, nextSlaBreachAt)) {
        changes.slaBreachAt = {
          before: task.slaBreachAt?.toISOString() ?? null,
          after: nextSlaBreachAt?.toISOString() ?? null,
        };
        task.slaBreachAt = nextSlaBreachAt;
      }
    }

    if (
      Object.prototype.hasOwnProperty.call(dto, 'metadata') &&
      dto.metadata &&
      !this.isJsonEqual(task.metadata, dto.metadata)
    ) {
      changes.metadata = { before: task.metadata, after: dto.metadata };
      task.metadata = dto.metadata;
    }

    if (Object.keys(changes).length === 0) {
      return this.findOne(actor, taskId);
    }

    await manager.getRepository(Task).save(task);

    this.events.emit('task.updated', {
      taskId: task.id,
      tenantId: task.tenantId,
      incidentId: task.incidentId,
      actorId: actor.id,
      changes,
    });

    return this.findOne(actor, taskId);
  }

  async updatePosition(
    actor: RequestUser,
    taskId: string,
    dto: UpdateTaskPositionDto,
  ): Promise<TaskDetail> {
    const manager =
      this.databaseContext.getManager() ?? this.dataSource.manager;
    const taskRepository = manager.getRepository(Task);
    const task = await this.findVisibleTask(actor, taskId, {
      repository: taskRepository,
      forUpdate: true,
    });

    if (!this.canEditTask(actor, task)) {
      throw new ForbiddenException('TASK_UPDATE_FORBIDDEN');
    }

    const laneTasks = await taskRepository
      .createQueryBuilder('task')
      .where('task.tenant_id = :tenantId', { tenantId: task.tenantId })
      .andWhere('task.deleted_at IS NULL')
      .andWhere('task.status = :status', { status: task.status })
      .andWhere('task.parent_task_id IS NOT DISTINCT FROM :parentTaskId', {
        parentTaskId: task.parentTaskId,
      })
      .andWhere('task.incident_id IS NOT DISTINCT FROM :incidentId', {
        incidentId: task.incidentId,
      })
      .orderBy('task.position', 'ASC')
      .addOrderBy('task.createdAt', 'ASC')
      .setLock('pessimistic_write')
      .getMany();

    const currentIndex = laneTasks.findIndex((item) => item.id === task.id);
    if (currentIndex === -1) {
      throw new NotFoundException('TASK_NOT_FOUND');
    }

    const nextIndex = Math.max(0, Math.min(dto.position, laneTasks.length - 1));
    if (currentIndex === nextIndex) {
      return this.findOne(actor, taskId);
    }

    const reordered = [...laneTasks];
    const [movedTask] = reordered.splice(currentIndex, 1);
    reordered.splice(nextIndex, 0, movedTask);

    const changedTasks: Task[] = [];
    reordered.forEach((item, index) => {
      if (item.position !== index) {
        item.position = index;
        changedTasks.push(item);
      }
    });

    if (changedTasks.length > 0) {
      await taskRepository.save(changedTasks);
    }

    this.events.emit('task.position_changed', {
      taskId: task.id,
      tenantId: task.tenantId,
      incidentId: task.incidentId,
      actorId: actor.id,
      status: task.status,
      before: currentIndex,
      after: nextIndex,
    });

    return this.findOne(actor, taskId);
  }

  async findAll(actor: RequestUser, query: ListTasksDto): Promise<Task[]> {
    const qb = this.buildVisibleQuery(this.tasks, actor).take(
      this.normalizeLimit(query.limit),
    );

    if (query.incidentId) {
      qb.andWhere('task.incident_id = :incidentId', {
        incidentId: query.incidentId,
      });
    }
    if (query.assigneeId) {
      qb.andWhere('task.assignee_id = :assigneeId', {
        assigneeId: query.assigneeId,
      });
    }
    if (query.status) {
      qb.andWhere('task.status = :status', { status: query.status });
    }
    if (query.priority) {
      qb.andWhere('task.priority = :priority', { priority: query.priority });
    }
    if (query.parentTaskId) {
      qb.andWhere('task.parent_task_id = :parentTaskId', {
        parentTaskId: query.parentTaskId,
      });
    }
    if (query.dueBefore) {
      qb.andWhere('task.due_at <= :dueBefore', { dueBefore: query.dueBefore });
    }
    if (query.dueAfter) {
      qb.andWhere('task.due_at >= :dueAfter', { dueAfter: query.dueAfter });
    }

    this.applySort(qb, query.sort);
    return qb.getMany();
  }

  async findOne(actor: RequestUser, id: string): Promise<TaskDetail> {
    const task = await this.findVisibleTask(actor, id);
    return this.buildTaskDetail(actor, task);
  }

  async getBoard(actor: RequestUser, query: TaskBoardDto): Promise<TaskBoard> {
    const qb = this.buildVisibleQuery(this.tasks, actor)
      .andWhere('task.parent_task_id IS NULL')
      .orderBy('task.status', 'ASC')
      .addOrderBy('task.position', 'ASC')
      .addOrderBy('task.priority', 'ASC')
      .addOrderBy('task.createdAt', 'ASC');

    if (query.incidentId) {
      qb.andWhere('task.incident_id = :incidentId', {
        incidentId: query.incidentId,
      });
    }

    return this.toBoard(await qb.getMany());
  }

  async getMyTasks(actor: RequestUser, query: ListTasksDto): Promise<Task[]> {
    const qb = this.buildVisibleQuery(this.tasks, actor)
      .andWhere('task.assignee_id = :actorId', { actorId: actor.id })
      .take(this.normalizeLimit(query.limit));

    if (query.status) {
      qb.andWhere('task.status = :status', { status: query.status });
    }
    if (query.priority) {
      qb.andWhere('task.priority = :priority', { priority: query.priority });
    }
    if (query.dueBefore) {
      qb.andWhere('task.due_at <= :dueBefore', { dueBefore: query.dueBefore });
    }
    if (query.dueAfter) {
      qb.andWhere('task.due_at >= :dueAfter', { dueAfter: query.dueAfter });
    }

    qb.orderBy('task.priority', 'ASC')
      .addOrderBy('task.dueAt', 'ASC', 'NULLS LAST')
      .addOrderBy('task.createdAt', 'DESC');

    return qb.getMany();
  }

  async getOverdueTasks(
    actor: RequestUser,
    query: ListOverdueTasksDto,
  ): Promise<Task[]> {
    const qb = this.buildVisibleQuery(this.tasks, actor)
      .andWhere('task.due_at IS NOT NULL')
      .andWhere('task.due_at < :now', { now: new Date().toISOString() })
      .andWhere('task.status NOT IN (:...terminalStatuses)', {
        terminalStatuses: ['done', 'cancelled'],
      })
      .take(this.normalizeLimit(query.limit));

    if (query.incidentId) {
      qb.andWhere('task.incident_id = :incidentId', {
        incidentId: query.incidentId,
      });
    }

    qb.orderBy('task.dueAt', 'ASC')
      .addOrderBy('task.priority', 'ASC')
      .addOrderBy('task.createdAt', 'ASC');

    return qb.getMany();
  }

  async listComments(
    actor: RequestUser,
    taskId: string,
    query: ListTaskCommentsDto,
  ): Promise<TaskComment[]> {
    const task = await this.findVisibleTask(actor, taskId);

    return this.comments.find({
      where: { taskId: task.id, tenantId: task.tenantId, deletedAt: IsNull() },
      relations: ['author'],
      order: { createdAt: 'DESC' },
      take: this.normalizeCommentsLimit(query.limit),
    });
  }

  async addComment(
    actor: RequestUser,
    taskId: string,
    dto: AddTaskCommentDto,
  ): Promise<TaskComment> {
    const task = await this.findVisibleTask(actor, taskId);

    const comment = this.comments.create({
      taskId: task.id,
      tenantId: task.tenantId,
      authorId: actor.id,
      body: dto.body.trim(),
    });
    const saved = await this.comments.save(comment);

    this.events.emit('task.commented', {
      taskId: task.id,
      tenantId: task.tenantId,
      incidentId: task.incidentId,
      actorId: actor.id,
      commentId: saved.id,
    });

    return saved;
  }

  async assign(
    actor: RequestUser,
    taskId: string,
    dto: AssignTaskDto,
  ): Promise<TaskDetail> {
    const manager =
      this.databaseContext.getManager() ?? this.dataSource.manager;
    const task = await this.findVisibleTask(actor, taskId, {
      repository: manager.getRepository(Task),
      forUpdate: true,
    });

    this.assertMutable(task);
    if (!this.canManageTask(actor, task)) {
      throw new ForbiddenException('TASK_ASSIGN_FORBIDDEN');
    }

    await this.ensureAssignableUser(
      actor.tenantId,
      dto.assigneeId,
      task.incident,
    );

    const previousAssigneeId = task.assigneeId;
    if (previousAssigneeId === dto.assigneeId) {
      return this.findOne(actor, taskId);
    }

    task.assigneeId = dto.assigneeId;
    task.assignerId = actor.id;
    if (dto.reason?.trim()) {
      task.metadata = {
        ...task.metadata,
        lastAssignmentReason: dto.reason.trim(),
      };
    }

    await manager.getRepository(Task).save(task);
    await this.recordAssignment(
      task,
      actor.id,
      task.assigneeId,
      dto.reason?.trim() ?? null,
    );

    this.events.emit('task.assigned', {
      taskId: task.id,
      tenantId: task.tenantId,
      incidentId: task.incidentId,
      actorId: actor.id,
      previousAssigneeId,
      newAssigneeId: task.assigneeId,
      reason: dto.reason?.trim() ?? null,
    });

    return this.findOne(actor, taskId);
  }

  async transition(
    actor: RequestUser,
    taskId: string,
    dto: TransitionTaskStatusDto,
  ): Promise<TaskDetail> {
    const manager =
      this.databaseContext.getManager() ?? this.dataSource.manager;
    const task = await this.findVisibleTask(actor, taskId, {
      repository: manager.getRepository(Task),
      forUpdate: true,
    });

    this.assertMutable(task);
    const available = this.getAvailableTransitionsForTask(actor, task);
    const transition = available.find((item) => item.code === dto.transition);

    if (!transition) {
      throw new UnprocessableEntityException('TASK_INVALID_TRANSITION');
    }

    if (transition.requires.includes('reason') && !dto.reason?.trim()) {
      throw new UnprocessableEntityException('TASK_INVALID_TRANSITION');
    }

    if (dto.transition === 'complete' || dto.transition === 'approve') {
      await this.assertSubtasksComplete(task.id, task.tenantId);
    }

    const before = task.status;
    const after = this.mapTransitionToStatus(dto.transition);
    task.status = after;

    if (before === 'todo' && after === 'in_progress' && !task.startedAt) {
      task.startedAt = new Date();
    }
    if (after === 'done') {
      task.completedAt = new Date();
    }
    if (dto.reason?.trim()) {
      task.metadata = {
        ...task.metadata,
        lastTransitionReason: dto.reason.trim(),
      };
    }

    await manager.getRepository(Task).save(task);

    this.events.emit('task.status_changed', {
      taskId: task.id,
      tenantId: task.tenantId,
      incidentId: task.incidentId,
      actorId: actor.id,
      before,
      after,
      reason: dto.reason?.trim() ?? null,
    });

    if (after === 'done') {
      this.events.emit('task.completed', {
        taskId: task.id,
        tenantId: task.tenantId,
        incidentId: task.incidentId,
        actorId: actor.id,
        completedAt: task.completedAt?.toISOString() ?? null,
      });
    }

    return this.findOne(actor, taskId);
  }

  async getAvailableTransitions(
    actor: RequestUser,
    taskId: string,
  ): Promise<AvailableTransition[]> {
    const task = await this.findVisibleTask(actor, taskId);
    return this.getAvailableTransitionsForTask(actor, task);
  }

  private buildVisibleQuery(
    repository: Repository<Task>,
    actor: RequestUser,
    options?: { forUpdate?: boolean },
  ): SelectQueryBuilder<Task> {
    const qb = repository
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.assignee', 'assignee')
      .leftJoinAndSelect('task.assigner', 'assigner')
      .leftJoinAndSelect('task.incident', 'incident')
      .leftJoinAndSelect('task.parentTask', 'parentTask')
      .where('task.tenant_id = :tenantId', { tenantId: actor.tenantId })
      .andWhere('task.deleted_at IS NULL')
      .andWhere(
        '(task.incident_id IS NULL OR incident.classification <= :clearance)',
        { clearance: actor.clearance },
      );

    if (options?.forUpdate) {
      qb.setLock('pessimistic_write');
    }

    if (!this.canReadAllTasks(actor)) {
      qb.leftJoin(
        IncidentParticipant,
        'participant',
        'participant.incident_id = task.incident_id AND participant.user_id = :actorId AND participant.left_at IS NULL',
        { actorId: actor.id },
      );
      qb.andWhere(
        new Brackets((visible) => {
          visible
            .where('task.assignee_id = :actorId', { actorId: actor.id })
            .orWhere('task.assigner_id = :actorId', { actorId: actor.id })
            .orWhere('task.created_by = :actorId', { actorId: actor.id })
            .orWhere('incident.commander_id = :actorId', { actorId: actor.id })
            .orWhere('participant.user_id IS NOT NULL');
        }),
      );
      qb.andWhere(
        new Brackets((drafts) => {
          drafts
            .where('task.incident_id IS NULL')
            .orWhere('incident.status <> :draftStatus', {
              draftStatus: 'draft',
            })
            .orWhere('incident.created_by = :actorId', { actorId: actor.id });
        }),
      );
    }

    return qb;
  }

  private async findVisibleTask(
    actor: RequestUser,
    taskId: string,
    options?: { repository?: Repository<Task>; forUpdate?: boolean },
  ): Promise<Task> {
    const repository = options?.repository ?? this.tasks;
    const task = await this.buildVisibleQuery(repository, actor, {
      forUpdate: options?.forUpdate,
    })
      .andWhere('task.id = :id', { id: taskId })
      .getOne();

    if (!task) {
      throw new NotFoundException('TASK_NOT_FOUND');
    }

    return task;
  }

  private async buildTaskDetail(
    actor: RequestUser,
    task: Task,
  ): Promise<TaskDetail> {
    const [
      subtasks,
      latestComments,
      assignmentHistory,
      subtaskCount,
      completedSubtaskCount,
      commentCount,
    ] = await Promise.all([
      this.buildVisibleQuery(this.tasks, actor)
        .andWhere('task.parent_task_id = :parentTaskId', {
          parentTaskId: task.id,
        })
        .orderBy('task.position', 'ASC')
        .addOrderBy('task.createdAt', 'ASC')
        .getMany(),
      this.comments.find({
        where: {
          taskId: task.id,
          tenantId: task.tenantId,
          deletedAt: IsNull(),
        },
        relations: ['author'],
        order: { createdAt: 'DESC' },
        take: 10,
      }),
      this.assignmentHistory.find({
        where: { taskId: task.id, tenantId: task.tenantId },
        relations: ['assignee', 'assignedByUser'],
        order: { assignedAt: 'DESC' },
      }),
      this.tasks.count({
        where: {
          parentTaskId: task.id,
          tenantId: task.tenantId,
          deletedAt: IsNull(),
        },
      }),
      this.tasks.count({
        where: {
          parentTaskId: task.id,
          tenantId: task.tenantId,
          status: 'done',
          deletedAt: IsNull(),
        },
      }),
      this.comments.count({
        where: {
          taskId: task.id,
          tenantId: task.tenantId,
          deletedAt: IsNull(),
        },
      }),
    ]);

    return {
      ...task,
      subtasks,
      latestComments,
      assignmentHistory,
      stats: {
        subtaskCount,
        completedSubtaskCount,
        commentCount,
        dependencyCount: 0,
      },
    };
  }

  private toBoard(tasks: Task[]): TaskBoard {
    return {
      todo: tasks.filter((task) => task.status === 'todo'),
      inProgress: tasks.filter((task) => task.status === 'in_progress'),
      blocked: tasks.filter((task) => task.status === 'blocked'),
      review: tasks.filter((task) => task.status === 'review'),
      done: tasks.filter((task) => task.status === 'done'),
      cancelled: tasks.filter((task) => task.status === 'cancelled'),
    };
  }

  private getAvailableTransitionsForTask(
    actor: RequestUser,
    task: Task,
  ): AvailableTransition[] {
    const canManage = this.canManageTask(actor, task);
    const isAssignee = task.assigneeId === actor.id;

    switch (task.status) {
      case 'todo':
        return [
          ...(isAssignee
            ? [
                {
                  code: 'start' as const,
                  label: 'Start task',
                  requires: [],
                },
              ]
            : []),
          ...(canManage
            ? [
                {
                  code: 'cancel' as const,
                  label: 'Cancel task',
                  requires: [],
                },
              ]
            : []),
        ];
      case 'in_progress':
        return [
          ...(isAssignee
            ? [
                {
                  code: 'block' as const,
                  label: 'Block task',
                  requires: ['reason'],
                },
                {
                  code: 'submit_for_review' as const,
                  label: 'Submit for review',
                  requires: [],
                },
                {
                  code: 'complete' as const,
                  label: 'Complete task',
                  requires: [],
                },
              ]
            : []),
          ...(canManage
            ? [
                {
                  code: 'cancel' as const,
                  label: 'Cancel task',
                  requires: [],
                },
              ]
            : []),
        ];
      case 'blocked':
        return canManage
          ? [
              {
                code: 'unblock' as const,
                label: 'Unblock task',
                requires: [],
              },
              {
                code: 'cancel' as const,
                label: 'Cancel task',
                requires: [],
              },
            ]
          : [];
      case 'review':
        return canManage
          ? [
              {
                code: 'approve' as const,
                label: 'Approve task',
                requires: [],
              },
              {
                code: 'reject' as const,
                label: 'Reject task',
                requires: [],
              },
            ]
          : [];
      default:
        return [];
    }
  }

  private mapTransitionToStatus(
    transition: TransitionTaskStatusDto['transition'],
  ): TaskStatus {
    switch (transition) {
      case 'start':
      case 'unblock':
      case 'reject':
        return 'in_progress';
      case 'block':
        return 'blocked';
      case 'submit_for_review':
        return 'review';
      case 'complete':
      case 'approve':
        return 'done';
      case 'cancel':
        return 'cancelled';
    }
  }

  private async ensureParentTask(
    tenantId: string,
    parentTaskId: string | undefined,
  ): Promise<Task | null> {
    if (!parentTaskId) {
      return null;
    }

    const parent = await this.tasks.findOne({
      where: { id: parentTaskId, tenantId, deletedAt: IsNull() },
    });

    if (!parent) {
      throw new NotFoundException('TASK_NOT_FOUND');
    }

    let depth = 0;
    let cursor = parent.parentTaskId;

    while (cursor) {
      depth += 1;
      if (depth >= 3) {
        throw new UnprocessableEntityException('TASK_DEPTH_EXCEEDED');
      }

      const next = await this.tasks.findOne({
        where: { id: cursor, tenantId, deletedAt: IsNull() },
      });
      cursor = next?.parentTaskId ?? null;
    }

    return parent;
  }

  private async loadIncident(
    tenantId: string,
    incidentId: string,
  ): Promise<Incident> {
    const incident = await this.incidents.findOne({
      where: { id: incidentId, tenantId },
    });

    if (!incident) {
      throw new NotFoundException('Incident not found');
    }

    return incident;
  }

  private assertIncidentVisible(actor: RequestUser, incident: Incident): void {
    if (incident.classification > actor.clearance) {
      throw new NotFoundException('Incident not found');
    }

    if (
      incident.status === 'draft' &&
      incident.createdBy !== actor.id &&
      !this.canReadDrafts(actor)
    ) {
      throw new NotFoundException('Incident not found');
    }
  }

  private async ensureAssignableUser(
    tenantId: string,
    userId: string,
    incident: Incident | null,
  ): Promise<void> {
    const user = await this.users.findOne({
      where: { id: userId, tenantId, status: 'active' },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!incident) {
      return;
    }

    if (incident.commanderId === userId) {
      return;
    }

    const participant = await this.participants.findOne({
      where: { incidentId: incident.id, userId },
    });

    if (!participant || participant.leftAt) {
      throw new UnprocessableEntityException('TASK_ASSIGNEE_NOT_PARTICIPANT');
    }
  }

  private async getNextPosition(
    tenantId: string,
    incidentId: string | null,
    status: TaskStatus,
    parentTaskId: string | null,
  ): Promise<number> {
    const qb = this.tasks
      .createQueryBuilder('task')
      .select('COALESCE(MAX(task.position), -1)', 'maxPosition')
      .where('task.tenant_id = :tenantId', { tenantId })
      .andWhere('task.deleted_at IS NULL')
      .andWhere('task.status = :status', { status });

    if (incidentId) {
      qb.andWhere('task.incident_id = :incidentId', { incidentId });
    } else {
      qb.andWhere('task.incident_id IS NULL');
    }

    if (parentTaskId) {
      qb.andWhere('task.parent_task_id = :parentTaskId', { parentTaskId });
    } else {
      qb.andWhere('task.parent_task_id IS NULL');
    }

    const row = await qb.getRawOne<{ maxPosition: string }>();
    return Number(row?.maxPosition ?? -1) + 1;
  }

  private assertMutable(task: Task): void {
    if (task.status === 'done') {
      throw new UnprocessableEntityException('TASK_DONE_IMMUTABLE');
    }
    if (task.status === 'cancelled') {
      throw new UnprocessableEntityException('TASK_CANCELLED_IMMUTABLE');
    }
  }

  private async assertSubtasksComplete(
    taskId: string,
    tenantId: string,
  ): Promise<void> {
    const incompleteCount = await this.tasks
      .createQueryBuilder('task')
      .where('task.parent_task_id = :taskId', { taskId })
      .andWhere('task.tenant_id = :tenantId', { tenantId })
      .andWhere('task.deleted_at IS NULL')
      .andWhere('task.status NOT IN (:...terminalStatuses)', {
        terminalStatuses: ['done', 'cancelled'],
      })
      .getCount();

    if (incompleteCount > 0) {
      throw new UnprocessableEntityException('TASK_SUBTASKS_INCOMPLETE');
    }
  }

  private applySort(
    qb: SelectQueryBuilder<Task>,
    sort: ListTasksDto['sort'] | undefined,
  ): void {
    switch (sort) {
      case 'priority_asc':
        qb.orderBy('task.priority', 'ASC').addOrderBy('task.createdAt', 'DESC');
        return;
      case 'priority_desc':
        qb.orderBy('task.priority', 'DESC').addOrderBy(
          'task.createdAt',
          'DESC',
        );
        return;
      case 'due_at_asc':
        qb.orderBy('task.dueAt', 'ASC', 'NULLS LAST').addOrderBy(
          'task.createdAt',
          'DESC',
        );
        return;
      case 'due_at_desc':
        qb.orderBy('task.dueAt', 'DESC', 'NULLS LAST').addOrderBy(
          'task.createdAt',
          'DESC',
        );
        return;
      case 'position_asc':
        qb.orderBy('task.status', 'ASC')
          .addOrderBy('task.position', 'ASC')
          .addOrderBy('task.createdAt', 'ASC');
        return;
      default:
        qb.orderBy('task.createdAt', 'DESC').addOrderBy('task.id', 'DESC');
    }
  }

  private normalizeLimit(limit: number | undefined): number {
    if (!limit || Number.isNaN(Number(limit))) {
      return 25;
    }

    return Math.max(1, Math.min(100, Number(limit)));
  }

  private normalizeCommentsLimit(limit: number | undefined): number {
    if (!limit || Number.isNaN(Number(limit))) {
      return 50;
    }

    return Math.max(1, Math.min(100, Number(limit)));
  }

  private async recordAssignment(
    task: Task,
    assignedBy: string,
    assigneeId: string | null,
    reason: string | null,
  ): Promise<TaskAssignmentHistory> {
    const entry = this.assignmentHistory.create({
      taskId: task.id,
      tenantId: task.tenantId,
      assigneeId,
      assignedBy,
      reason,
    });

    return this.assignmentHistory.save(entry);
  }

  private canEditTask(actor: RequestUser, task: Task): boolean {
    return task.assigneeId === actor.id || this.canManageTask(actor, task);
  }

  private canManageTask(actor: RequestUser, task: Task): boolean {
    if (this.canReadAllTasks(actor)) {
      return true;
    }

    if (task.incident?.commanderId === actor.id) {
      return true;
    }

    if (
      !task.incidentId &&
      (task.assignerId === actor.id || task.createdBy === actor.id)
    ) {
      return true;
    }

    return false;
  }

  private canManageIncidentTasks(
    actor: RequestUser,
    incident: Pick<Incident, 'commanderId'>,
  ): boolean {
    return this.canReadAllTasks(actor) || incident.commanderId === actor.id;
  }

  private canManageStandaloneTasks(actor: RequestUser): boolean {
    return this.canReadAllTasks(actor);
  }

  private canReadAllTasks(actor: RequestUser): boolean {
    return this.hasAnyRole(actor, [
      'platform_admin',
      'tenant_admin',
      'shift_lead',
    ]);
  }

  private canReadDrafts(actor: RequestUser): boolean {
    return this.canReadAllTasks(actor);
  }

  private hasAnyRole(actor: RequestUser, roles: string[]): boolean {
    return actor.roles.some((role) => roles.includes(role));
  }

  private sameDate(left: Date | null, right: Date | null): boolean {
    if (!left && !right) {
      return true;
    }
    if (!left || !right) {
      return false;
    }
    return left.getTime() === right.getTime();
  }

  private isJsonEqual(
    left: Record<string, unknown>,
    right: Record<string, unknown>,
  ): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
  }
}
