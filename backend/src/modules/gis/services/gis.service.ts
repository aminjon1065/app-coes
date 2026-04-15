import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, IsNull, Repository } from 'typeorm';
import { RequestUser } from '../../../shared/auth/current-user.decorator';
import { DatabaseContextService } from '../../../shared/database/database-context.service';
import { IncidentParticipant } from '../../incident/entities/incident-participant.entity';
import { Incident } from '../../incident/entities/incident.entity';
import { Task } from '../../task/entities/task.entity';
import { CreateFeatureDto } from '../dto/create-feature.dto';
import { CreateLayerDto } from '../dto/create-layer.dto';
import { ListLayersDto } from '../dto/list-layers.dto';
import { NearbyFeaturesDto } from '../dto/nearby-features.dto';
import { UpdateFeatureDto } from '../dto/update-feature.dto';
import { UpdateLayerDto } from '../dto/update-layer.dto';
import { MapFeature } from '../entities/map-feature.entity';
import { MapLayer } from '../entities/map-layer.entity';

type GeoJsonFeatureCollection = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    id: string;
    geometry: Record<string, unknown>;
    properties: Record<string, unknown>;
  }>;
};

@Injectable()
export class GisService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly databaseContext: DatabaseContextService,
    private readonly events: EventEmitter2,
  ) {}

  private get layers(): Repository<MapLayer> {
    return this.databaseContext.getRepository(this.dataSource, MapLayer);
  }

  private get features(): Repository<MapFeature> {
    return this.databaseContext.getRepository(this.dataSource, MapFeature);
  }

  private get incidents(): Repository<Incident> {
    return this.databaseContext.getRepository(this.dataSource, Incident);
  }

  private get participants(): Repository<IncidentParticipant> {
    return this.databaseContext.getRepository(this.dataSource, IncidentParticipant);
  }

  private get tasks(): Repository<Task> {
    return this.databaseContext.getRepository(this.dataSource, Task);
  }

  async listLayers(actor: RequestUser, query: ListLayersDto): Promise<MapLayer[]> {
    const qb = this.layers
      .createQueryBuilder('layer')
      .leftJoinAndSelect('layer.incident', 'incident')
      .leftJoinAndSelect('layer.creator', 'creator')
      .where('layer.tenant_id = :tenantId', { tenantId: actor.tenantId })
      .andWhere('layer.archived_at IS NULL');

    if (query.kind) {
      qb.andWhere('layer.kind = :kind', { kind: query.kind });
    }
    if (query.incidentId) {
      qb.andWhere('layer.incident_id = :incidentId', { incidentId: query.incidentId });
    }
    if (query.publicOnly === 'true') {
      qb.andWhere('layer.is_public = true');
    }

    const layers = await qb.orderBy('layer.updated_at', 'DESC').getMany();
    const visible: MapLayer[] = [];
    for (const layer of layers) {
      if (await this.canViewLayer(actor, layer)) {
        visible.push(layer);
      }
    }
    return visible;
  }

  async createLayer(actor: RequestUser, dto: CreateLayerDto): Promise<MapLayer> {
    await this.assertIncidentAccess(actor, dto.incidentId ?? null, true);

    const layer = this.layers.create({
      tenantId: actor.tenantId,
      incidentId: dto.incidentId ?? null,
      kind: dto.kind,
      name: dto.name.trim(),
      description: dto.description?.trim() ?? null,
      style: dto.style ?? {},
      isPublic: dto.isPublic ?? false,
      createdBy: actor.id,
      archivedAt: null,
    });

    const saved = await this.layers.save(layer);
    this.events.emit('gis.layer.created', {
      tenantId: saved.tenantId,
      actorId: actor.id,
      layerId: saved.id,
      incidentId: saved.incidentId,
      kind: saved.kind,
    });
    return this.findLayer(actor, saved.id);
  }

  async findLayer(actor: RequestUser, id: string): Promise<MapLayer> {
    const layer = await this.layers.findOne({
      where: { id, tenantId: actor.tenantId, archivedAt: IsNull() },
      relations: ['incident', 'creator'],
    });
    if (!layer || !(await this.canViewLayer(actor, layer))) {
      throw new NotFoundException('GIS layer not found');
    }
    return layer;
  }

  async updateLayer(actor: RequestUser, id: string, dto: UpdateLayerDto): Promise<MapLayer> {
    const layer = await this.findLayer(actor, id);
    this.assertLayerManage(actor, layer);

    if (Object.prototype.hasOwnProperty.call(dto, 'name') && dto.name) {
      layer.name = dto.name.trim();
    }
    if (Object.prototype.hasOwnProperty.call(dto, 'description')) {
      layer.description = dto.description?.trim() ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(dto, 'style') && dto.style) {
      layer.style = dto.style;
    }
    if (Object.prototype.hasOwnProperty.call(dto, 'isPublic') && dto.isPublic !== undefined) {
      layer.isPublic = dto.isPublic;
    }

    const saved = await this.layers.save(layer);
    this.events.emit('gis.layer.updated', {
      tenantId: saved.tenantId,
      actorId: actor.id,
      layerId: saved.id,
      incidentId: saved.incidentId,
    });
    return this.findLayer(actor, saved.id);
  }

  async archiveLayer(actor: RequestUser, id: string): Promise<void> {
    const layer = await this.findLayer(actor, id);
    this.assertLayerManage(actor, layer);
    if (!layer.archivedAt) {
      layer.archivedAt = new Date();
      await this.layers.save(layer);
      this.events.emit('gis.layer.archived', {
        tenantId: layer.tenantId,
        actorId: actor.id,
        layerId: layer.id,
        incidentId: layer.incidentId,
      });
    }
  }

  async getLayerFeatures(actor: RequestUser, layerId: string): Promise<GeoJsonFeatureCollection> {
    const layer = await this.findLayer(actor, layerId);
    return this.loadFeatureCollection({
      clause: 'f.layer_id = $1',
      params: [layer.id],
      tenantId: actor.tenantId,
    });
  }

  async createFeature(
    actor: RequestUser,
    layerId: string,
    dto: CreateFeatureDto,
  ): Promise<{ id: string }> {
    const layer = await this.findLayer(actor, layerId);
    this.assertLayerManage(actor, layer);
    await this.assertLinkedObjects(actor.tenantId, dto.linkedIncidentId, dto.linkedTaskId);

    const rows = await this.dataSource.query(
      `
        INSERT INTO gis.features (
          layer_id,
          tenant_id,
          geometry,
          properties,
          label,
          linked_incident_id,
          linked_task_id,
          created_by
        )
        VALUES (
          $1,
          $2,
          ST_SetSRID(ST_GeomFromGeoJSON($3), 4326),
          $4::jsonb,
          $5,
          $6,
          $7,
          $8
        )
        RETURNING id
      `,
      [
        layer.id,
        actor.tenantId,
        JSON.stringify(dto.geometry),
        JSON.stringify(dto.properties ?? {}),
        dto.label?.trim() ?? null,
        dto.linkedIncidentId ?? null,
        dto.linkedTaskId ?? null,
        actor.id,
      ],
    );

    const id = rows[0]?.id as string;
    this.events.emit('gis.feature.created', {
      tenantId: actor.tenantId,
      actorId: actor.id,
      layerId: layer.id,
      featureId: id,
      incidentId: layer.incidentId ?? dto.linkedIncidentId ?? null,
    });
    return { id };
  }

  async updateFeature(
    actor: RequestUser,
    layerId: string,
    featureId: string,
    dto: UpdateFeatureDto,
  ): Promise<{ id: string }> {
    const layer = await this.findLayer(actor, layerId);
    this.assertLayerManage(actor, layer);
    await this.findFeatureRow(actor, layerId, featureId);
    await this.assertLinkedObjects(actor.tenantId, dto.linkedIncidentId, dto.linkedTaskId);

    await this.dataSource.query(
      `
        UPDATE gis.features
        SET
          geometry = COALESCE(ST_SetSRID(ST_GeomFromGeoJSON($4), 4326), geometry),
          properties = COALESCE($5::jsonb, properties),
          label = COALESCE($6, label),
          linked_incident_id = COALESCE($7, linked_incident_id),
          linked_task_id = COALESCE($8, linked_task_id),
          updated_at = now()
        WHERE id = $1
          AND layer_id = $2
          AND tenant_id = $3
          AND deleted_at IS NULL
      `,
      [
        featureId,
        layerId,
        actor.tenantId,
        dto.geometry ? JSON.stringify(dto.geometry) : null,
        dto.properties ? JSON.stringify(dto.properties) : null,
        dto.label?.trim() ?? null,
        dto.linkedIncidentId ?? null,
        dto.linkedTaskId ?? null,
      ],
    );

    this.events.emit('gis.feature.updated', {
      tenantId: actor.tenantId,
      actorId: actor.id,
      layerId,
      featureId,
      incidentId: layer.incidentId ?? dto.linkedIncidentId ?? null,
    });
    return { id: featureId };
  }

  async deleteFeature(actor: RequestUser, layerId: string, featureId: string): Promise<void> {
    const layer = await this.findLayer(actor, layerId);
    this.assertLayerManage(actor, layer);
    await this.findFeatureRow(actor, layerId, featureId);

    await this.dataSource.query(
      `
        UPDATE gis.features
        SET deleted_at = now(), updated_at = now()
        WHERE id = $1
          AND layer_id = $2
          AND tenant_id = $3
          AND deleted_at IS NULL
      `,
      [featureId, layerId, actor.tenantId],
    );

    this.events.emit('gis.feature.deleted', {
      tenantId: actor.tenantId,
      actorId: actor.id,
      layerId,
      featureId,
      incidentId: layer.incidentId,
    });
  }

  async getIncidentFeatures(
    actor: RequestUser,
    incidentId: string,
  ): Promise<GeoJsonFeatureCollection> {
    await this.assertIncidentAccess(actor, incidentId, false);
    return this.loadFeatureCollection({
      clause: '(l.incident_id = $1 OR f.linked_incident_id = $1)',
      params: [incidentId],
      tenantId: actor.tenantId,
    });
  }

  async nearbyFeatures(
    actor: RequestUser,
    query: NearbyFeaturesDto,
  ): Promise<GeoJsonFeatureCollection> {
    const rows = await this.dataSource.query(
      `
        SELECT
          f.id,
          ST_AsGeoJSON(f.geometry)::jsonb AS geometry,
          f.properties,
          f.label,
          f.linked_incident_id AS "linkedIncidentId",
          f.linked_task_id AS "linkedTaskId",
          l.id AS "layerId",
          l.name AS "layerName",
          l.kind AS "layerKind"
        FROM gis.features f
        INNER JOIN gis.layers l ON l.id = f.layer_id
        LEFT JOIN incident.incidents i ON i.id = l.incident_id
        WHERE f.tenant_id = $1
          AND f.deleted_at IS NULL
          AND l.archived_at IS NULL
          AND ST_DWithin(
            f.geometry::geography,
            ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
            $4
          )
          AND (
            l.incident_id IS NULL
            OR (i.classification <= $5 AND (i.status <> 'draft' OR i.created_by = $6 OR i.commander_id = $6))
          )
        ORDER BY ST_Distance(
          f.geometry::geography,
          ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography
        ) ASC
      `,
      [actor.tenantId, query.lng, query.lat, query.radius, actor.clearance, actor.id],
    );

    return {
      type: 'FeatureCollection',
      features: rows.map((row: any) => ({
        type: 'Feature',
        id: row.id,
        geometry: row.geometry,
        properties: {
          ...(row.properties ?? {}),
          label: row.label ?? null,
          linkedIncidentId: row.linkedIncidentId ?? null,
          linkedTaskId: row.linkedTaskId ?? null,
          layerId: row.layerId,
          layerName: row.layerName,
          layerKind: row.layerKind,
        },
      })),
    };
  }

  private async loadFeatureCollection(input: {
    clause: string;
    params: unknown[];
    tenantId: string;
  }): Promise<GeoJsonFeatureCollection> {
    const rows = await this.dataSource.query(
      `
        SELECT
          f.id,
          ST_AsGeoJSON(f.geometry)::jsonb AS geometry,
          f.properties,
          f.label,
          f.linked_incident_id AS "linkedIncidentId",
          f.linked_task_id AS "linkedTaskId",
          l.id AS "layerId",
          l.name AS "layerName",
          l.kind AS "layerKind"
        FROM gis.features f
        INNER JOIN gis.layers l ON l.id = f.layer_id
        WHERE ${input.clause}
          AND f.tenant_id = $${input.params.length + 1}
          AND f.deleted_at IS NULL
          AND l.archived_at IS NULL
        ORDER BY f.created_at ASC
      `,
      [...input.params, input.tenantId],
    );

    return {
      type: 'FeatureCollection',
      features: rows.map((row: any) => ({
        type: 'Feature',
        id: row.id,
        geometry: row.geometry,
        properties: {
          ...(row.properties ?? {}),
          label: row.label ?? null,
          linkedIncidentId: row.linkedIncidentId ?? null,
          linkedTaskId: row.linkedTaskId ?? null,
          layerId: row.layerId,
          layerName: row.layerName,
          layerKind: row.layerKind,
        },
      })),
    };
  }

  private async findFeatureRow(actor: RequestUser, layerId: string, featureId: string) {
    const rows = await this.dataSource.query(
      `
        SELECT id
        FROM gis.features
        WHERE id = $1
          AND layer_id = $2
          AND tenant_id = $3
          AND deleted_at IS NULL
      `,
      [featureId, layerId, actor.tenantId],
    );
    if (!rows[0]) {
      throw new NotFoundException('GIS feature not found');
    }
    return rows[0];
  }

  private async canViewLayer(actor: RequestUser, layer: MapLayer): Promise<boolean> {
    if (layer.isPublic) {
      return true;
    }
    if (!layer.incidentId) {
      return true;
    }
    return this.hasIncidentAccess(actor, layer.incidentId);
  }

  private async assertIncidentAccess(
    actor: RequestUser,
    incidentId: string | null,
    requireManage: boolean,
  ): Promise<void> {
    if (!incidentId) {
      return;
    }
    const allowed = requireManage
      ? await this.hasIncidentManageAccess(actor, incidentId)
      : await this.hasIncidentAccess(actor, incidentId);
    if (!allowed) {
      throw new ForbiddenException('GIS_INCIDENT_ACCESS_DENIED');
    }
  }

  private async hasIncidentAccess(actor: RequestUser, incidentId: string): Promise<boolean> {
    const incident = await this.incidents.findOne({
      where: { id: incidentId, tenantId: actor.tenantId },
      select: { id: true, classification: true, status: true, createdBy: true, commanderId: true },
    });
    if (!incident || incident.classification > actor.clearance) {
      return false;
    }
    if (incident.status !== 'draft') {
      return true;
    }
    if (
      incident.createdBy === actor.id ||
      incident.commanderId === actor.id ||
      actor.roles.includes('platform_admin') ||
      actor.roles.includes('tenant_admin') ||
      actor.roles.includes('shift_lead')
    ) {
      return true;
    }
    const participant = await this.participants.findOne({
      where: { incidentId, userId: actor.id, leftAt: null as never },
      select: { userId: true },
    });
    return Boolean(participant);
  }

  private async hasIncidentManageAccess(actor: RequestUser, incidentId: string): Promise<boolean> {
    const incident = await this.incidents.findOne({
      where: { id: incidentId, tenantId: actor.tenantId },
      select: { commanderId: true, createdBy: true, classification: true },
    });
    if (!incident || incident.classification > actor.clearance) {
      return false;
    }
    if (
      actor.roles.includes('platform_admin') ||
      actor.roles.includes('tenant_admin') ||
      actor.roles.includes('shift_lead') ||
      actor.roles.includes('gis_analyst')
    ) {
      return true;
    }
    return incident.commanderId === actor.id || incident.createdBy === actor.id;
  }

  private assertLayerManage(actor: RequestUser, layer: MapLayer) {
    if (
      layer.createdBy === actor.id ||
      actor.roles.includes('platform_admin') ||
      actor.roles.includes('tenant_admin') ||
      actor.roles.includes('shift_lead') ||
      actor.roles.includes('gis_analyst')
    ) {
      return;
    }
    throw new ForbiddenException('GIS_LAYER_UPDATE_FORBIDDEN');
  }

  private async assertLinkedObjects(
    tenantId: string,
    incidentId?: string | null,
    taskId?: string | null,
  ) {
    if (incidentId) {
      const incident = await this.incidents.findOne({
        where: { id: incidentId, tenantId },
        select: { id: true },
      });
      if (!incident) {
        throw new UnprocessableEntityException('GIS_LINKED_INCIDENT_NOT_FOUND');
      }
    }
    if (taskId) {
      const task = await this.tasks.findOne({
        where: { id: taskId, tenantId, deletedAt: IsNull() },
        select: { id: true },
      });
      if (!task) {
        throw new UnprocessableEntityException('GIS_LINKED_TASK_NOT_FOUND');
      }
    }
  }
}
