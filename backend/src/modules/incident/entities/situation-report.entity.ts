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

type SitrepLocation = {
  lat: number;
  lon: number;
} | null;

@Entity({ name: 'sitreps', schema: 'incident' })
@Index('idx_sitreps_incident_reported_at', ['incidentId', 'reportedAt'])
@Index('idx_sitreps_tenant_id', ['tenantId'])
export class SituationReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'incident_id', type: 'uuid' })
  incidentId: string;

  @ManyToOne(() => Incident, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'incident_id' })
  incident: Incident;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'reporter_id', type: 'uuid' })
  reporterId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'reporter_id' })
  reporter: User;

  @Column({ type: 'smallint', nullable: true })
  severity: number | null;

  @Column({ type: 'text' })
  text: string;

  @Column({ type: 'jsonb', default: [] })
  attachments: string[];

  @Column({ type: 'jsonb', nullable: true })
  location: SitrepLocation;

  @CreateDateColumn({ name: 'reported_at', type: 'timestamptz' })
  reportedAt: Date;
}
