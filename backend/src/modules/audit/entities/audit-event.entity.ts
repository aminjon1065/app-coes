import {
  Column,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity({ name: 'events', schema: 'audit' })
@Index('idx_audit_tenant_ts', ['tenantId', 'ts'])
@Index('idx_audit_actor_ts', ['actorId', 'ts'], {
  where: '"actor_id" IS NOT NULL',
})
@Index('idx_audit_target', ['targetType', 'targetId'], {
  where: '"target_id" IS NOT NULL',
})
export class AuditEventEntity {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @PrimaryColumn({ type: 'timestamptz' })
  ts: Date;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId: string | null;

  @Column({ name: 'event_type', type: 'text' })
  eventType: string;

  @Column({ name: 'target_type', type: 'text', nullable: true })
  targetType: string | null;

  @Column({ name: 'target_id', type: 'uuid', nullable: true })
  targetId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  before: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  after: Record<string, unknown> | null;

  @Column({ type: 'inet', nullable: true })
  ip: string | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent: string | null;

  @Column({ name: 'session_id', type: 'uuid', nullable: true })
  sessionId: string | null;
}
