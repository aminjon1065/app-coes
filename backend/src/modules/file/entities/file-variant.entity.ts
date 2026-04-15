import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { FileEntity } from './file.entity';

export const FILE_VARIANT_TYPES = ['thumbnail', 'preview', 'ocr_text'] as const;

export type FileVariantType = (typeof FILE_VARIANT_TYPES)[number];

@Entity({ name: 'variants', schema: 'file' })
export class FileVariantEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'file_id', type: 'uuid' })
  fileId: string;

  @ManyToOne(() => FileEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'file_id' })
  file: FileEntity;

  @Column({ name: 'variant_type', type: 'text' })
  variantType: FileVariantType;

  @Column({ name: 'storage_bucket', type: 'text' })
  storageBucket: string;

  @Column({ name: 'storage_key', type: 'text' })
  storageKey: string;

  @Column({ name: 'size_bytes', type: 'bigint', nullable: true })
  sizeBytes: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
