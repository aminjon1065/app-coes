import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../iam/entities/user.entity';
import { Incident } from './incident.entity';

export const INCIDENT_TIMELINE_KINDS = [
  'status_change',
  'severity_change',
  'assignment',
  'sitrep',
  'document',
  'note',
  'participant_joined',
  'participant_left',
  'geofence_update',
  'epicenter_update',
  'escalation',
  'classification_change',
  'commander_assigned',
  'resource_deployed',
  'resource_returned',
] as const;

export type IncidentTimelineKind = (typeof INCIDENT_TIMELINE_KINDS)[number];

@Entity({ name: 'timeline', schema: 'incident' })
@Index('idx_timeline_incident_ts', ['incidentId', 'ts'])
@Index('idx_timeline_tenant_id', ['tenantId'])
@Index('idx_timeline_kind', ['incidentId', 'kind'])
export class IncidentTimelineEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'incident_id', type: 'uuid' })
  incidentId: string;

  @ManyToOne(() => Incident, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'incident_id' })
  incident: Incident;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @CreateDateColumn({ name: 'ts', type: 'timestamptz' })
  ts: Date;

  @Column({ type: 'text' })
  kind: IncidentTimelineKind;

  @Column({ name: 'actor_id', type: 'uuid' })
  actorId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'actor_id' })
  actor: User;

  @Column({ type: 'jsonb', default: {} })
  payload: Record<string, unknown>;
}
