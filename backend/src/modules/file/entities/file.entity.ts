import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Tenant } from '../../iam/entities/tenant.entity';
import { User } from '../../iam/entities/user.entity';

export const FILE_SCAN_STATUSES = ['PENDING', 'CLEAN', 'INFECTED', 'ERROR'] as const;

export type FileScanStatus = (typeof FILE_SCAN_STATUSES)[number];

@Entity({ name: 'files', schema: 'file' })
@Index('idx_files_tenant', ['tenantId'], { where: `"deleted_at" IS NULL` })
@Index('idx_files_uploader', ['uploadedBy'])
export class FileEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ name: 'original_name', type: 'text' })
  originalName: string;

  @Column({ name: 'content_type', type: 'text' })
  contentType: string;

  @Column({ name: 'size_bytes', type: 'bigint' })
  sizeBytes: string;

  @Column({ name: 'storage_bucket', type: 'text' })
  storageBucket: string;

  @Column({ name: 'storage_key', type: 'text' })
  storageKey: string;

  @Column({ name: 'checksum_sha256', type: 'text' })
  checksumSha256: string;

  @Column({ name: 'scan_status', type: 'text', default: 'PENDING' })
  scanStatus: FileScanStatus;

  @Column({ name: 'scan_result_detail', type: 'text', nullable: true })
  scanResultDetail: string | null;

  @Column({ name: 'uploaded_by', type: 'uuid' })
  uploadedBy: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'uploaded_by' })
  uploader: User;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}
