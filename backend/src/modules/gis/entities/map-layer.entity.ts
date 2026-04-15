import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  CreateDateColumn,
} from 'typeorm';
import { Tenant } from '../../iam/entities/tenant.entity';
import { User } from '../../iam/entities/user.entity';
import { Incident } from '../../incident/entities/incident.entity';

export const GIS_LAYER_KINDS = [
  'BASE',
  'HAZARD',
  'RESOURCE',
  'ROUTE',
  'INCIDENT',
  'DRAW',
] as const;

export type GisLayerKind = (typeof GIS_LAYER_KINDS)[number];

@Entity({ name: 'layers', schema: 'gis' })
@Index('idx_layers_tenant', ['tenantId'], { where: '"archived_at" IS NULL' })
@Index('idx_layers_incident', ['incidentId'], {
  where: '"incident_id" IS NOT NULL',
})
export class MapLayer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ name: 'incident_id', type: 'uuid', nullable: true })
  incidentId: string | null;

  @ManyToOne(() => Incident, { nullable: true })
  @JoinColumn({ name: 'incident_id' })
  incident: Incident | null;

  @Column({ type: 'text' })
  kind: GisLayerKind;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'jsonb', default: {} })
  style: Record<string, unknown>;

  @Column({ name: 'is_public', type: 'boolean', default: false })
  isPublic: boolean;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt: Date | null;
}
