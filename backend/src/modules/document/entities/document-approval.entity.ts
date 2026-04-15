import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../iam/entities/user.entity';
import { DocumentEntity } from './document.entity';
import { DocumentVersion } from './document-version.entity';

export const DOCUMENT_APPROVAL_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
] as const;

export type DocumentApprovalStatus =
  (typeof DOCUMENT_APPROVAL_STATUSES)[number];

@Entity({ name: 'approvals', schema: 'document' })
export class DocumentApproval {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'document_id', type: 'uuid' })
  documentId: string;

  @ManyToOne(() => DocumentEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document: DocumentEntity;

  @Column({ name: 'version_id', type: 'uuid' })
  versionId: string;

  @ManyToOne(() => DocumentVersion, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'version_id' })
  version: DocumentVersion;

  @Column({ name: 'approver_id', type: 'uuid' })
  approverId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'approver_id' })
  approver: User;

  @Column({ type: 'text', default: 'PENDING' })
  status: DocumentApprovalStatus;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @Column({ name: 'signed_at', type: 'timestamptz', nullable: true })
  signedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
