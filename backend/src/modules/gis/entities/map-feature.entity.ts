import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Tenant } from '../../iam/entities/tenant.entity';
import { User } from '../../iam/entities/user.entity';
import { Incident } from '../../incident/entities/incident.entity';
import { Task } from '../../task/entities/task.entity';
import { MapLayer } from './map-layer.entity';

export type GeoJsonGeometry = {
  type: string;
  coordinates?: unknown;
  geometries?: GeoJsonGeometry[];
};

@Entity({ name: 'features', schema: 'gis' })
@Index('idx_features_layer', ['layerId'], { where: '"deleted_at" IS NULL' })
@Index('idx_features_incident', ['linkedIncidentId'], {
  where: '"linked_incident_id" IS NOT NULL',
})
export class MapFeature {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'layer_id', type: 'uuid' })
  layerId: string;

  @ManyToOne(() => MapLayer, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'layer_id' })
  layer: MapLayer;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({
    type: 'geometry',
    spatialFeatureType: 'Geometry',
    srid: 4326,
  })
  geometry: GeoJsonGeometry;

  @Column({ type: 'jsonb', default: {} })
  properties: Record<string, unknown>;

  @Column({ type: 'text', nullable: true })
  label: string | null;

  @Column({ name: 'linked_incident_id', type: 'uuid', nullable: true })
  linkedIncidentId: string | null;

  @ManyToOne(() => Incident, { nullable: true })
  @JoinColumn({ name: 'linked_incident_id' })
  linkedIncident: Incident | null;

  @Column({ name: 'linked_task_id', type: 'uuid', nullable: true })
  linkedTaskId: string | null;

  @ManyToOne(() => Task, { nullable: true })
  @JoinColumn({ name: 'linked_task_id' })
  linkedTask: Task | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
