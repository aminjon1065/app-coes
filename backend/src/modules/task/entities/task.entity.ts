import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Incident } from '../../incident/entities/incident.entity';
import { Tenant } from '../../iam/entities/tenant.entity';
import { User } from '../../iam/entities/user.entity';

export const TASK_STATUSES = [
  'todo',
  'in_progress',
  'blocked',
  'review',
  'done',
  'cancelled',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

@Entity({ name: 'tasks', schema: 'task' })
@Index('idx_tasks_tenant_incident_status', ['tenantId', 'incidentId', 'status'])
@Index('idx_tasks_incident_open', ['incidentId', 'status'], {
  where: `"deleted_at" IS NULL`,
})
export class Task {
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
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'text', default: 'todo' })
  status: TaskStatus;

  @Column({ type: 'smallint', default: 3 })
  priority: number;

  @Column({ name: 'assignee_id', type: 'uuid', nullable: true })
  assigneeId: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'assignee_id' })
  assignee: User | null;

  @Column({ name: 'assigner_id', type: 'uuid' })
  assignerId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'assigner_id' })
  assigner: User;

  @Column({ name: 'due_at', type: 'timestamptz', nullable: true })
  dueAt: Date | null;

  @Column({ name: 'sla_breach_at', type: 'timestamptz', nullable: true })
  slaBreachAt: Date | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'parent_task_id', type: 'uuid', nullable: true })
  parentTaskId: string | null;

  @ManyToOne(() => Task, { nullable: true })
  @JoinColumn({ name: 'parent_task_id' })
  parentTask: Task | null;

  @Column({ type: 'integer', default: 0 })
  position: number;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}
