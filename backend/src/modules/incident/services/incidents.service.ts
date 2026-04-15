import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Brackets, DataSource, IsNull, Repository } from 'typeorm';
import { RequestUser } from '../../../shared/auth/current-user.decorator';
import { DatabaseContextService } from '../../../shared/database/database-context.service';
import { UserRole } from '../../iam/entities/user-role.entity';
import { User } from '../../iam/entities/user.entity';
import { Task } from '../../task/entities/task.entity';
import { AddParticipantDto } from '../dto/add-participant.dto';
import { ChangeSeverityDto } from '../dto/change-severity.dto';
import { CreateIncidentDto } from '../dto/create-incident.dto';
import {
  IncidentParticipant,
  IncidentParticipantRole,
} from '../entities/incident-participant.entity';
import { ListIncidentsDto } from '../dto/list-incidents.dto';
import { ListSitrepsDto } from '../dto/list-sitreps.dto';
import { ListTimelineDto } from '../dto/list-timeline.dto';
import { SubmitSitrepDto } from '../dto/submit-sitrep.dto';
import { TransitionStatusDto } from '../dto/transition-status.dto';
import {
  IncidentTimelineEntry,
  IncidentTimelineKind,
} from '../entities/incident-timeline-entry.entity';
import {
  Incident,
  IncidentCategory,
  IncidentStatus,
} from '../entities/incident.entity';
import { SituationReport } from '../entities/situation-report.entity';

type AvailableTransition = {
  code: TransitionStatusDto['transition'];
  label: string;
  requires: string[];
};

@Injectable()
export class IncidentsService {
  private readonly logger = new Logger(IncidentsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly databaseContext: DatabaseContextService,
    private readonly events: EventEmitter2,
  ) {}

  private get incidents(): Repository<Incident> {
    return this.databaseContext.getRepository(this.dataSource, Incident);
  }

  private get users(): Repository<User> {
    return this.databaseContext.getRepository(this.dataSource, User);
  }

  private get userRoles(): Repository<UserRole> {
    return this.databaseContext.getRepository(this.dataSource, UserRole);
  }

  private get participants(): Repository<IncidentParticipant> {
    return this.databaseContext.getRepository(
      this.dataSource,
      IncidentParticipant,
    );
  }

  private get timelineEntries(): Repository<IncidentTimelineEntry> {
    return this.databaseContext.getRepository(
      this.dataSource,
      IncidentTimelineEntry,
    );
  }

  private get sitreps(): Repository<SituationReport> {
    return this.databaseContext.getRepository(this.dataSource, SituationReport);
  }

  private get tasks(): Repository<Task> {
    return this.databaseContext.getRepository(this.dataSource, Task);
  }

  async create(actor: RequestUser, dto: CreateIncidentDto): Promise<Incident> {
    await this.ensureCommander(dto.commanderId, actor.tenantId);
    await this.ensureParent(actor.tenantId, dto.parentId);

    const incident = this.incidents.create({
      tenantId: actor.tenantId,
      code: await this.generateCode(dto.category),
      title: dto.title.trim(),
      description: dto.description?.trim() ?? null,
      category: dto.category,
      severity: dto.severity,
      status: 'draft',
      classification: dto.classification ?? 1,
      commanderId: dto.commanderId ?? null,
      parentId: dto.parentId ?? null,
      metadata: dto.metadata ?? {},
      createdBy: actor.id,
      openedAt: null,
      closedAt: null,
    });

    const saved = await this.incidents.save(incident);
    await this.createTimelineEntry({
      incidentId: saved.id,
      tenantId: saved.tenantId,
      actorId: actor.id,
      kind: 'status_change',
      payload: {
        after: saved.status,
      },
    });

    this.events.emit('incident.created', {
      incidentId: saved.id,
      tenantId: saved.tenantId,
      actorId: actor.id,
    });

    return this.findOne(actor, saved.id);
  }

  async findAll(
    actor: RequestUser,
    query: ListIncidentsDto,
  ): Promise<Incident[]> {
    const qb = (await this.baseVisibleQuery(actor)).take(query.limit ?? 25);

    if (query.q?.trim()) {
      const term = `%${query.q.trim()}%`;
      qb.andWhere(
        new Brackets((searchQb) => {
          searchQb
            .where('incident.code ILIKE :term', { term })
            .orWhere('incident.title ILIKE :term', { term })
            .orWhere("COALESCE(incident.description, '') ILIKE :term", {
              term,
            });
        }),
      );
    }
    if (query.status) {
      qb.andWhere('incident.status = :status', { status: query.status });
    }
    if (query.category) {
      qb.andWhere('incident.category = :category', {
        category: query.category,
      });
    }
    if (query.severity) {
      qb.andWhere('incident.severity = :severity', {
        severity: query.severity,
      });
    }

    switch (query.sort ?? 'newest') {
      case 'updated':
        qb.orderBy('incident.updatedAt', 'DESC').addOrderBy(
          'incident.createdAt',
          'DESC',
        );
        break;
      case 'severity_desc':
        qb.orderBy('incident.severity', 'DESC').addOrderBy(
          'incident.updatedAt',
          'DESC',
        );
        break;
      case 'severity_asc':
        qb.orderBy('incident.severity', 'ASC').addOrderBy(
          'incident.updatedAt',
          'DESC',
        );
        break;
      case 'code_asc':
        qb.orderBy('incident.code', 'ASC').addOrderBy(
          'incident.updatedAt',
          'DESC',
        );
        break;
      case 'newest':
      default:
        qb.orderBy('incident.createdAt', 'DESC').addOrderBy(
          'incident.updatedAt',
          'DESC',
        );
        break;
    }

    return qb.getMany();
  }

  async findOne(actor: RequestUser, id: string): Promise<Incident> {
    const incident = await (await this.baseVisibleQuery(actor))
      .andWhere('incident.id = :id', { id })
      .getOne();
    if (!incident) {
      throw new NotFoundException('Incident not found');
    }
    return incident;
  }

  async transition(
    actor: RequestUser,
    incidentId: string,
    dto: TransitionStatusDto,
  ): Promise<Incident> {
    const manager =
      this.databaseContext.getManager() ?? this.dataSource.manager;
    const incident = await manager
      .getRepository(Incident)
      .createQueryBuilder('incident')
      .leftJoinAndSelect('incident.commander', 'commander')
      .where('incident.id = :id', { id: incidentId })
      .andWhere('incident.tenant_id = :tenantId', { tenantId: actor.tenantId })
      .setLock('pessimistic_write')
      .getOne();

    if (!incident) {
      throw new NotFoundException('Incident not found');
    }

    this.assertIncidentVisibility(actor, incident);
    const available = this.getAvailableTransitionsForIncident(actor, incident);
    const transition = available.find((item) => item.code === dto.transition);

    if (!transition) {
      throw new UnprocessableEntityException('INCIDENT_INVALID_TRANSITION');
    }

    if (transition.requires.includes('reason') && !dto.reason?.trim()) {
      throw new UnprocessableEntityException('Transition reason is required');
    }
    if (
      transition.requires.includes('resolutionSummary') &&
      !dto.resolutionSummary?.trim()
    ) {
      throw new UnprocessableEntityException('INCIDENT_MISSING_RESOLUTION');
    }

    const before = incident.status;
    const nextStatus = this.mapTransitionToStatus(dto.transition);
    incident.status = nextStatus;

    if (before === 'draft' && nextStatus === 'open') {
      incident.openedAt = new Date();
    }
    if (nextStatus === 'closed') {
      await this.assertNoOpenTasks(incident.id, incident.tenantId);
      incident.closedAt = new Date();
      incident.metadata = {
        ...incident.metadata,
        resolutionSummary: dto.resolutionSummary?.trim(),
      };
    }
    if (before === 'closed' && nextStatus === 'open') {
      incident.closedAt = null;
    }
    if (dto.reason?.trim()) {
      incident.metadata = {
        ...incident.metadata,
        lastTransitionReason: dto.reason.trim(),
      };
    }

    await manager.getRepository(Incident).save(incident);
    await this.createTimelineEntry({
      incidentId: incident.id,
      tenantId: incident.tenantId,
      actorId: actor.id,
      kind: dto.transition === 'escalate' ? 'escalation' : 'status_change',
      payload: {
        before,
        after: nextStatus,
        reason: dto.reason?.trim() ?? null,
        resolutionSummary: dto.resolutionSummary?.trim() ?? null,
        transition: dto.transition,
      },
    });

    this.events.emit('incident.status_changed', {
      incidentId: incident.id,
      tenantId: incident.tenantId,
      actorId: actor.id,
      before,
      after: nextStatus,
      reason: dto.reason?.trim() ?? null,
    });

    return this.findOne(actor, incidentId);
  }

  async getAvailableTransitions(
    actor: RequestUser,
    incidentId: string,
  ): Promise<AvailableTransition[]> {
    const incident = await this.findOne(actor, incidentId);
    return this.getAvailableTransitionsForIncident(actor, incident);
  }

  async changeSeverity(
    actor: RequestUser,
    incidentId: string,
    dto: ChangeSeverityDto,
  ): Promise<Incident> {
    const manager =
      this.databaseContext.getManager() ?? this.dataSource.manager;
    const incident = await this.loadIncidentForUpdate(
      manager,
      actor,
      incidentId,
    );

    if (incident.status === 'closed' || incident.status === 'archived') {
      throw new UnprocessableEntityException('INCIDENT_INVALID_STATE');
    }

    const before = incident.severity;
    const after = dto.severity;
    if (before === after) {
      return this.findOne(actor, incidentId);
    }

    const isRaise = after > before;
    const canRaise =
      incident.commanderId === actor.id ||
      this.hasAnyRole(actor, ['shift_lead', 'tenant_admin', 'platform_admin']);
    const canLower = this.hasAnyRole(actor, [
      'shift_lead',
      'tenant_admin',
      'platform_admin',
    ]);

    if ((isRaise && !canRaise) || (!isRaise && !canLower)) {
      throw new UnprocessableEntityException(
        'INCIDENT_SEVERITY_ESCALATION_DENIED',
      );
    }

    incident.severity = after;
    await manager.getRepository(Incident).save(incident);
    await this.createTimelineEntry({
      incidentId: incident.id,
      tenantId: incident.tenantId,
      actorId: actor.id,
      kind: 'severity_change',
      payload: {
        before,
        after,
        reason: dto.reason.trim(),
      },
    });

    this.events.emit('incident.severity_changed', {
      incidentId: incident.id,
      tenantId: incident.tenantId,
      actorId: actor.id,
      before,
      after,
      reason: dto.reason.trim(),
    });

    return this.findOne(actor, incidentId);
  }

  async assignCommander(
    actor: RequestUser,
    incidentId: string,
    userId: string,
  ): Promise<Incident> {
    const manager =
      this.databaseContext.getManager() ?? this.dataSource.manager;
    const incident = await this.loadIncidentForUpdate(
      manager,
      actor,
      incidentId,
    );

    const targetUser = await this.users.findOne({
      where: { id: userId, tenantId: actor.tenantId, status: 'active' },
      select: { id: true },
    });
    if (!targetUser) {
      throw new UnprocessableEntityException('INCIDENT_COMMANDER_REQUIRED');
    }

    const previousCommanderId = incident.commanderId;
    if (previousCommanderId === userId) {
      return this.findOne(actor, incidentId);
    }

    incident.commanderId = userId;
    await manager.getRepository(Incident).save(incident);
    if (previousCommanderId) {
      await this.upsertParticipant(
        manager,
        incident.id,
        previousCommanderId,
        'observer',
      );
    }
    await this.upsertParticipant(manager, incident.id, userId, 'commander');
    await this.createTimelineEntry({
      incidentId: incident.id,
      tenantId: incident.tenantId,
      actorId: actor.id,
      kind: 'commander_assigned',
      payload: {
        previousCommanderId,
        newCommanderId: userId,
      },
    });

    this.events.emit('incident.commander_assigned', {
      incidentId: incident.id,
      tenantId: incident.tenantId,
      actorId: actor.id,
      previousCommanderId,
      newCommanderId: userId,
    });

    return this.findOne(actor, incidentId);
  }

  async listParticipants(
    actor: RequestUser,
    incidentId: string,
  ): Promise<IncidentParticipant[]> {
    await this.findOne(actor, incidentId);

    return this.participants.find({
      where: { incidentId, leftAt: null as never },
      relations: ['user'],
      order: { joinedAt: 'ASC' },
    });
  }

  async addParticipant(
    actor: RequestUser,
    incidentId: string,
    userId: string,
    role: AddParticipantDto['role'],
  ): Promise<IncidentParticipant> {
    const manager =
      this.databaseContext.getManager() ?? this.dataSource.manager;
    const incident = await this.loadIncidentForUpdate(
      manager,
      actor,
      incidentId,
    );

    await this.ensureParticipantUser(userId, actor.tenantId);

    const existing = await manager.getRepository(IncidentParticipant).findOne({
      where: { incidentId, userId },
    });
    if (existing && !existing.leftAt) {
      throw new ConflictException('INCIDENT_PARTICIPANT_EXISTS');
    }

    const participant = await this.upsertParticipant(
      manager,
      incidentId,
      userId,
      role,
    );
    await this.createTimelineEntry({
      incidentId: incident.id,
      tenantId: incident.tenantId,
      actorId: actor.id,
      kind: 'participant_joined',
      payload: {
        userId,
        role,
      },
    });

    this.events.emit('incident.participant_added', {
      incidentId: incident.id,
      tenantId: incident.tenantId,
      actorId: actor.id,
      userId,
      role,
    });

    return participant;
  }

  async removeParticipant(
    actor: RequestUser,
    incidentId: string,
    userId: string,
  ): Promise<void> {
    const manager =
      this.databaseContext.getManager() ?? this.dataSource.manager;
    const incident = await this.loadIncidentForUpdate(
      manager,
      actor,
      incidentId,
    );

    if (incident.commanderId === userId) {
      throw new UnprocessableEntityException(
        'INCIDENT_COMMANDER_REASSIGN_REQUIRED',
      );
    }

    const participant = await manager
      .getRepository(IncidentParticipant)
      .findOne({
        where: { incidentId, userId },
      });
    if (!participant || participant.leftAt) {
      throw new NotFoundException('Participant not found');
    }

    participant.leftAt = new Date();
    await manager.getRepository(IncidentParticipant).save(participant);
    await this.createTimelineEntry({
      incidentId: incident.id,
      tenantId: incident.tenantId,
      actorId: actor.id,
      kind: 'participant_left',
      payload: {
        userId,
        role: participant.roleInIncident,
      },
    });

    this.events.emit('incident.participant_removed', {
      incidentId: incident.id,
      tenantId: incident.tenantId,
      actorId: actor.id,
      userId,
      role: participant.roleInIncident,
    });
  }

  async listSitreps(
    actor: RequestUser,
    incidentId: string,
    query: ListSitrepsDto,
  ): Promise<{
    data: SituationReport[];
    page: {
      nextCursor: string | null;
      prevCursor: string | null;
      limit: number;
      hasMore: boolean;
    };
  }> {
    await this.findOne(actor, incidentId);

    const limit = this.normalizeSitrepLimit(query.limit);
    const qb = this.sitreps
      .createQueryBuilder('sitrep')
      .where('sitrep.incident_id = :incidentId', { incidentId })
      .andWhere('sitrep.tenant_id = :tenantId', { tenantId: actor.tenantId })
      .orderBy('sitrep.reported_at', 'DESC')
      .addOrderBy('sitrep.id', 'DESC')
      .take(limit + 1);

    if (query.cursor) {
      const cursor = this.parseReportedCursor(query.cursor);
      qb.andWhere(
        '(sitrep.reported_at < :cursorTs OR (sitrep.reported_at = :cursorTs AND sitrep.id < :cursorId))',
        {
          cursorTs: cursor.ts.toISOString(),
          cursorId: cursor.id,
        },
      );
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      data.length > 0 ? this.toReportedCursor(data[data.length - 1]) : null;

    return {
      data,
      page: {
        nextCursor: hasMore ? nextCursor : null,
        prevCursor: query.cursor ?? null,
        limit,
        hasMore,
      },
    };
  }

  async submitSitrep(
    actor: RequestUser,
    incidentId: string,
    dto: SubmitSitrepDto,
  ): Promise<SituationReport> {
    const manager =
      this.databaseContext.getManager() ?? this.dataSource.manager;
    const incident = await this.loadIncidentForUpdate(
      manager,
      actor,
      incidentId,
    );

    if (!['open', 'escalated'].includes(incident.status)) {
      throw new UnprocessableEntityException('INCIDENT_SITREP_INVALID_STATE');
    }

    const participant = await manager
      .getRepository(IncidentParticipant)
      .findOne({
        where: { incidentId, userId: actor.id },
      });
    if (!participant || participant.leftAt) {
      throw new UnprocessableEntityException('INCIDENT_PARTICIPANT_REQUIRED');
    }

    const sitrep = manager.getRepository(SituationReport).create({
      incidentId: incident.id,
      tenantId: incident.tenantId,
      reporterId: actor.id,
      severity: dto.severity ?? null,
      text: dto.text.trim(),
      attachments: dto.attachments ?? [],
      location: dto.location
        ? {
            lat: dto.location.lat,
            lon: dto.location.lon,
          }
        : null,
    });
    const saved = await manager.getRepository(SituationReport).save(sitrep);

    await this.createTimelineEntry({
      incidentId: incident.id,
      tenantId: incident.tenantId,
      actorId: actor.id,
      kind: 'sitrep',
      payload: {
        sitrepId: saved.id,
        severity: saved.severity,
      },
    });

    this.events.emit('incident.sitrep.submitted', {
      incidentId: incident.id,
      tenantId: incident.tenantId,
      actorId: actor.id,
      sitrepId: saved.id,
    });

    return saved;
  }

  async getTimeline(
    actor: RequestUser,
    incidentId: string,
    query: ListTimelineDto,
  ): Promise<{
    data: IncidentTimelineEntry[];
    page: {
      nextCursor: string | null;
      prevCursor: string | null;
      limit: number;
      hasMore: boolean;
    };
  }> {
    await this.findOne(actor, incidentId);

    const limit = this.normalizeTimelineLimit(query.limit);
    const qb = this.timelineEntries
      .createQueryBuilder('timeline')
      .where('timeline.incident_id = :incidentId', { incidentId })
      .andWhere('timeline.tenant_id = :tenantId', { tenantId: actor.tenantId })
      .orderBy('timeline.ts', 'DESC')
      .addOrderBy('timeline.id', 'DESC')
      .take(limit + 1);

    if (query.cursor) {
      const cursor = this.parseTimelineCursor(query.cursor);
      qb.andWhere(
        '(timeline.ts < :cursorTs OR (timeline.ts = :cursorTs AND timeline.id < :cursorId))',
        {
          cursorTs: cursor.ts.toISOString(),
          cursorId: cursor.id,
        },
      );
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      data.length > 0 ? this.toTimelineCursor(data[data.length - 1]) : null;

    return {
      data,
      page: {
        nextCursor: hasMore ? nextCursor : null,
        prevCursor: query.cursor ?? null,
        limit,
        hasMore,
      },
    };
  }

  private async baseVisibleQuery(actor: RequestUser) {
    const qb = this.incidents
      .createQueryBuilder('incident')
      .leftJoinAndSelect('incident.commander', 'commander')
      .where('incident.tenant_id = :tenantId', { tenantId: actor.tenantId })
      .andWhere('incident.classification <= :clearance', {
        clearance: actor.clearance,
      });

    if (!this.canReadDrafts(actor)) {
      qb.andWhere(
        '(incident.status <> :draftStatus OR incident.created_by = :actorId)',
        {
          draftStatus: 'draft',
          actorId: actor.id,
        },
      );
    }

    if (actor.roles.includes('agency_liaison')) {
      const scopedIncidentIds = await this.resolveLiaisonIncidentScope(actor);
      if (scopedIncidentIds !== null) {
        if (scopedIncidentIds.length === 0) {
          qb.andWhere('1 = 0');
        } else {
          qb.andWhere('incident.id IN (:...scopedIncidentIds)', {
            scopedIncidentIds,
          });
        }
      }
    }

    return qb;
  }

  private canReadDrafts(actor: RequestUser): boolean {
    return this.hasAnyRole(actor, [
      'platform_admin',
      'tenant_admin',
      'shift_lead',
    ]);
  }

  private async resolveLiaisonIncidentScope(
    actor: RequestUser,
  ): Promise<string[] | null> {
    const assignments = await this.userRoles.find({
      where: { userId: actor.id },
      relations: ['role'],
    });
    const liaisonAssignments = assignments.filter(
      (assignment) => assignment.role?.code === 'agency_liaison',
    );

    if (liaisonAssignments.length === 0) {
      return [];
    }

    const registry = new Set<string>();
    let unscoped = false;

    for (const assignment of liaisonAssignments) {
      const scope = assignment.scope as { incidentScope?: unknown } | null;
      const incidentScope = Array.isArray(scope?.incidentScope)
        ? scope.incidentScope.filter(
            (item): item is string => typeof item === 'string',
          )
        : [];

      if (incidentScope.length === 0) {
        unscoped = true;
      }

      for (const incidentId of incidentScope) {
        registry.add(incidentId);
      }
    }

    if (unscoped) {
      return null;
    }

    const participantRows = await this.participants.find({
      where: { userId: actor.id, leftAt: IsNull() },
      select: { incidentId: true },
    });

    for (const participant of participantRows) {
      registry.add(participant.incidentId);
    }

    return Array.from(registry);
  }

  private getAvailableTransitionsForIncident(
    actor: RequestUser,
    incident: Incident,
  ): AvailableTransition[] {
    const privileged = this.hasAnyRole(actor, [
      'platform_admin',
      'tenant_admin',
      'shift_lead',
    ]);
    const commander = incident.commanderId === actor.id || privileged;
    const creator = incident.createdBy === actor.id || privileged;

    switch (incident.status) {
      case 'draft':
        return creator
          ? [{ code: 'open', label: 'Open incident', requires: [] }]
          : [];
      case 'open':
        return [
          ...(commander
            ? [
                {
                  code: 'escalate' as const,
                  label: 'Escalate incident',
                  requires: ['reason'],
                },
                {
                  code: 'contain' as const,
                  label: 'Mark as contained',
                  requires: ['reason'],
                },
              ]
            : []),
        ];
      case 'escalated':
        return [
          ...(privileged
            ? [
                {
                  code: 'de_escalate' as const,
                  label: 'De-escalate incident',
                  requires: ['reason'],
                },
              ]
            : []),
          ...(commander
            ? [
                {
                  code: 'contain' as const,
                  label: 'Mark as contained',
                  requires: ['reason'],
                },
              ]
            : []),
        ];
      case 'contained':
        return [
          ...(commander
            ? [
                {
                  code: 'close' as const,
                  label: 'Close incident',
                  requires: ['resolutionSummary'],
                },
              ]
            : []),
          ...(commander || privileged
            ? [
                {
                  code: 'reopen' as const,
                  label: 'Reopen incident',
                  requires: ['reason'],
                },
              ]
            : []),
        ];
      case 'closed':
        return [
          ...(commander || privileged
            ? [
                {
                  code: 'reopen' as const,
                  label: 'Reopen incident',
                  requires: ['reason'],
                },
              ]
            : []),
          ...(this.hasAnyRole(actor, ['platform_admin', 'tenant_admin'])
            ? [
                {
                  code: 'archive' as const,
                  label: 'Archive incident',
                  requires: [],
                },
              ]
            : []),
        ];
      default:
        return [];
    }
  }

  private mapTransitionToStatus(
    transition: TransitionStatusDto['transition'],
  ): IncidentStatus {
    switch (transition) {
      case 'open':
      case 'reopen':
        return 'open';
      case 'escalate':
        return 'escalated';
      case 'de_escalate':
        return 'open';
      case 'contain':
        return 'contained';
      case 'close':
        return 'closed';
      case 'archive':
        return 'archived';
    }
  }

  private async ensureCommander(
    commanderId: string | undefined,
    tenantId: string,
  ): Promise<void> {
    if (!commanderId) return;

    const commander = await this.users.findOne({
      where: { id: commanderId, tenantId },
      select: { id: true },
    });
    if (!commander) {
      throw new UnprocessableEntityException('INCIDENT_COMMANDER_REQUIRED');
    }
  }

  private async ensureParticipantUser(
    userId: string,
    tenantId: string,
  ): Promise<void> {
    const user = await this.users.findOne({
      where: { id: userId, tenantId, status: 'active' },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
  }

  private async ensureParent(
    tenantId: string,
    parentId: string | undefined,
  ): Promise<void> {
    if (!parentId) return;

    const parent = await this.incidents.findOne({
      where: { id: parentId, tenantId },
      select: { id: true, parentId: true },
    });
    if (!parent) {
      throw new NotFoundException('Parent incident not found');
    }

    let depth = 1;
    let cursor = parent.parentId;
    while (cursor) {
      depth += 1;
      if (depth >= 3) {
        throw new UnprocessableEntityException('INCIDENT_DEPTH_EXCEEDED');
      }
      const next = await this.incidents.findOne({
        where: { id: cursor, tenantId },
        select: { parentId: true },
      });
      cursor = next?.parentId ?? null;
    }
  }

  private async generateCode(category: IncidentCategory): Promise<string> {
    const now = new Date();
    const prefix = `${this.categoryCode(category)}-${now.getUTCFullYear()}-${String(
      now.getUTCMonth() + 1,
    ).padStart(2, '0')}-`;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const latest = await this.incidents
        .createQueryBuilder('incident')
        .where('incident.code LIKE :prefix', { prefix: `${prefix}%` })
        .orderBy('incident.code', 'DESC')
        .getOne();

      const lastSequence = latest
        ? Number(latest.code.split('-').at(-1) ?? '0')
        : 0;
      const code = `${prefix}${String(lastSequence + 1).padStart(4, '0')}`;

      const exists = await this.incidents.findOne({
        where: { code },
        select: { id: true },
      });
      if (!exists) {
        return code;
      }
    }

    this.logger.warn({ category }, 'Failed to generate unique incident code');
    throw new ConflictException('INCIDENT_CODE_CONFLICT');
  }

  private categoryCode(category: IncidentCategory): string {
    const codes: Record<IncidentCategory, string> = {
      earthquake: 'EQ',
      flood: 'FL',
      fire: 'FR',
      wildfire: 'WF',
      industrial: 'IN',
      cbrn: 'CB',
      mass_gathering: 'MG',
      medical: 'MD',
      transport: 'TR',
      other: 'OT',
    };

    return codes[category];
  }

  private hasAnyRole(actor: RequestUser, roles: string[]): boolean {
    return actor.roles.some((role) => roles.includes(role));
  }

  private async loadIncidentForUpdate(
    manager: Repository<Incident>['manager'],
    actor: RequestUser,
    incidentId: string,
  ): Promise<Incident> {
    const incident = await manager
      .getRepository(Incident)
      .createQueryBuilder('incident')
      .leftJoinAndSelect('incident.commander', 'commander')
      .where('incident.id = :id', { id: incidentId })
      .andWhere('incident.tenant_id = :tenantId', { tenantId: actor.tenantId })
      .setLock('pessimistic_write')
      .getOne();

    if (!incident) {
      throw new NotFoundException('Incident not found');
    }

    this.assertIncidentVisibility(actor, incident);
    return incident;
  }

  private assertIncidentVisibility(
    actor: RequestUser,
    incident: Incident,
  ): void {
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

  private async createTimelineEntry(params: {
    incidentId: string;
    tenantId: string;
    actorId: string;
    kind: IncidentTimelineKind;
    payload: Record<string, unknown>;
  }): Promise<IncidentTimelineEntry> {
    const entry = this.timelineEntries.create({
      incidentId: params.incidentId,
      tenantId: params.tenantId,
      actorId: params.actorId,
      kind: params.kind,
      payload: params.payload,
    });

    return this.timelineEntries.save(entry);
  }

  private async assertNoOpenTasks(
    incidentId: string,
    tenantId: string,
  ): Promise<void> {
    const blockingCount = await this.tasks
      .createQueryBuilder('task')
      .where('task.incident_id = :incidentId', { incidentId })
      .andWhere('task.tenant_id = :tenantId', { tenantId })
      .andWhere('task.deleted_at IS NULL')
      .andWhere('task.status NOT IN (:...terminalStatuses)', {
        terminalStatuses: ['done', 'cancelled'],
      })
      .getCount();

    if (blockingCount > 0) {
      throw new UnprocessableEntityException('INCIDENT_OPEN_TASKS_REMAIN');
    }
  }

  private async upsertParticipant(
    manager: Repository<Incident>['manager'],
    incidentId: string,
    userId: string,
    role: IncidentParticipantRole,
  ): Promise<IncidentParticipant> {
    const repository = manager.getRepository(IncidentParticipant);
    const existing = await repository.findOne({
      where: { incidentId, userId },
    });

    if (existing) {
      existing.roleInIncident = role;
      existing.leftAt = null;
      return repository.save(existing);
    }

    const participant = repository.create({
      incidentId,
      userId,
      roleInIncident: role,
      leftAt: null,
    });
    return repository.save(participant);
  }

  private normalizeTimelineLimit(limit: number | undefined): number {
    if (!limit || Number.isNaN(Number(limit))) {
      return 50;
    }
    return Math.max(1, Math.min(100, Number(limit)));
  }

  private normalizeSitrepLimit(limit: number | undefined): number {
    if (!limit || Number.isNaN(Number(limit))) {
      return 20;
    }
    return Math.max(1, Math.min(50, Number(limit)));
  }

  private parseTimelineCursor(cursor: string): { ts: Date; id: string } {
    const [ts, id] = cursor.split('|');
    const parsedTs = new Date(ts);

    if (!ts || !id || Number.isNaN(parsedTs.getTime())) {
      throw new UnprocessableEntityException('Invalid timeline cursor');
    }

    return { ts: parsedTs, id };
  }

  private toTimelineCursor(
    entry: Pick<IncidentTimelineEntry, 'ts' | 'id'>,
  ): string {
    return `${entry.ts.toISOString()}|${entry.id}`;
  }

  private parseReportedCursor(cursor: string): { ts: Date; id: string } {
    const [ts, id] = cursor.split('|');
    const parsedTs = new Date(ts);

    if (!ts || !id || Number.isNaN(parsedTs.getTime())) {
      throw new UnprocessableEntityException('Invalid sitrep cursor');
    }

    return { ts: parsedTs, id };
  }

  private toReportedCursor(
    entry: Pick<SituationReport, 'reportedAt' | 'id'>,
  ): string {
    return `${entry.reportedAt.toISOString()}|${entry.id}`;
  }
}
