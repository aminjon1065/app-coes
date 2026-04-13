import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { User } from '../../iam/entities/user.entity';
import { Incident } from './incident.entity';

export const INCIDENT_PARTICIPANT_ROLES = [
  'commander',
  'deputy',
  'liaison',
  'observer',
  'responder',
] as const;

export type IncidentParticipantRole =
  (typeof INCIDENT_PARTICIPANT_ROLES)[number];

@Entity({ name: 'participants', schema: 'incident' })
export class IncidentParticipant {
  @PrimaryColumn({ name: 'incident_id', type: 'uuid' })
  incidentId: string;

  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => Incident, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'incident_id' })
  incident: Incident;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'role_in_incident', type: 'text' })
  roleInIncident: IncidentParticipantRole;

  @CreateDateColumn({ name: 'joined_at', type: 'timestamptz' })
  joinedAt: Date;

  @Column({ name: 'left_at', type: 'timestamptz', nullable: true })
  leftAt: Date | null;
}
