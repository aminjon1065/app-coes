import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'fact_incidents', schema: 'analytics' })
@Index('idx_fact_incidents_tenant', ['tenantId'])
@Index('idx_fact_incidents_opened', ['openedAt'])
@Index('idx_fact_incidents_category', ['category'])
export class FactIncident {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'incident_id', type: 'uuid', unique: true })
  incidentId: string;

  @Column({ name: 'opened_at', type: 'timestamptz' })
  openedAt: Date;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @Column({ name: 'duration_minutes', type: 'integer', nullable: true })
  durationMinutes: number | null;

  @Column({ type: 'text', nullable: true })
  category: string | null;

  @Column({ name: 'severity_peak', type: 'smallint', nullable: true })
  severityPeak: number | null;

  @Column({ name: 'status_final', type: 'text', nullable: true })
  statusFinal: string | null;

  @Column({ name: 'tasks_total', type: 'integer', default: 0 })
  tasksTotal: number;

  @Column({ name: 'tasks_done', type: 'integer', default: 0 })
  tasksDone: number;

  @Column({ name: 'tasks_breached_sla', type: 'integer', default: 0 })
  tasksBreachedSla: number;

  @Column({ name: 'participants_count', type: 'integer', default: 0 })
  participantsCount: number;

  @Column({ name: 'sitreps_count', type: 'integer', default: 0 })
  sitrepsCount: number;
}
