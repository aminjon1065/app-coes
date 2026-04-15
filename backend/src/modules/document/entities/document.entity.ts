import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Tenant } from '../../iam/entities/tenant.entity';
import { User } from '../../iam/entities/user.entity';
import { Incident } from '../../incident/entities/incident.entity';
import { DocumentApproval } from './document-approval.entity';
import { DocumentVersion } from './document-version.entity';

export const DOCUMENT_LIFECYCLE_STATES = [
  'DRAFT',
  'REVIEW',
  'APPROVED',
  'PUBLISHED',
  'ARCHIVED',
  'REVOKED',
] as const;

export type DocumentLifecycleState = (typeof DOCUMENT_LIFECYCLE_STATES)[number];

@Entity({ name: 'documents', schema: 'document' })
@Index('idx_documents_tenant', ['tenantId'])
@Index('idx_documents_incident', ['incidentId'], {
  where: '"incident_id" IS NOT NULL',
})
@Index('idx_documents_state', ['lifecycleState'])
export class DocumentEntity {
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

  @Column({ name: 'template_code', type: 'text' })
  templateCode: string;

  @Column({ type: 'smallint', default: 1 })
  classification: number;

  @Column({ name: 'lifecycle_state', type: 'text', default: 'DRAFT' })
  lifecycleState: DocumentLifecycleState;

  @Column({ name: 'current_version_id', type: 'uuid', nullable: true })
  currentVersionId: string | null;

  @OneToOne(() => DocumentVersion, { nullable: true })
  @JoinColumn({ name: 'current_version_id' })
  currentVersion: DocumentVersion | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @OneToMany(() => DocumentVersion, (version) => version.document)
  versions: DocumentVersion[];

  @OneToMany(() => DocumentApproval, (approval) => approval.document)
  approvals: DocumentApproval[];
}
