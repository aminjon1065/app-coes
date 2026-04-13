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

export const INCIDENT_CATEGORIES = [
  'earthquake',
  'flood',
  'fire',
  'wildfire',
  'industrial',
  'cbrn',
  'mass_gathering',
  'medical',
  'transport',
  'other',
] as const;

export const INCIDENT_STATUSES = [
  'draft',
  'open',
  'escalated',
  'contained',
  'closed',
  'archived',
] as const;

export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

@Entity({ name: 'incidents', schema: 'incident' })
@Index('idx_incidents_tenant_status', ['tenantId', 'status'])
@Index('idx_incidents_tenant_created_at', ['tenantId', 'createdAt'])
export class Incident {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ type: 'text', unique: true })
  code: string;

  @Column({ type: 'text' })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'text' })
  category: IncidentCategory;

  @Column({ type: 'smallint' })
  severity: number;

  @Column({ type: 'text', default: 'draft' })
  status: IncidentStatus;

  @Column({ type: 'smallint', default: 1 })
  classification: number;

  @Column({ name: 'commander_id', type: 'uuid', nullable: true })
  commanderId: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'commander_id' })
  commander: User | null;

  @Column({ name: 'opened_at', type: 'timestamptz', nullable: true })
  openedAt: Date | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId: string | null;

  @ManyToOne(() => Incident, { nullable: true })
  @JoinColumn({ name: 'parent_id' })
  parent: Incident | null;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
