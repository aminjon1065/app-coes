import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'tenant_invitations', schema: 'iam' })
export class TenantInvitation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'text' })
  email: string;

  @Column({ name: 'role_code', type: 'text', default: 'agency_liaison' })
  roleCode: string;

  @Column({
    name: 'incident_scope',
    type: 'uuid',
    array: true,
    default: () => "'{}'",
  })
  incidentScope: string[];

  @Column({ type: 'text', unique: true })
  token: string;

  @Column({ name: 'invited_by', type: 'uuid' })
  invitedBy: string;

  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
