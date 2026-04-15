import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'fact_tasks', schema: 'analytics' })
@Index('idx_fact_tasks_tenant', ['tenantId'])
@Index('idx_fact_tasks_incident', ['incidentId'], {
  where: '"incident_id" IS NOT NULL',
})
@Index('idx_fact_tasks_created', ['createdAt'])
export class FactTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'task_id', type: 'uuid', unique: true })
  taskId: string;

  @Column({ name: 'incident_id', type: 'uuid', nullable: true })
  incidentId: string | null;

  @Column({ type: 'smallint', nullable: true })
  priority: number | null;

  @Column({ name: 'status_final', type: 'text', nullable: true })
  statusFinal: string | null;

  @Column({ name: 'time_to_start_minutes', type: 'integer', nullable: true })
  timeToStartMinutes: number | null;

  @Column({ name: 'time_to_complete_minutes', type: 'integer', nullable: true })
  timeToCompleteMinutes: number | null;

  @Column({ name: 'sla_breached', type: 'boolean', default: false })
  slaBreached: boolean;

  @Column({ name: 'assignee_id', type: 'uuid', nullable: true })
  assigneeId: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
