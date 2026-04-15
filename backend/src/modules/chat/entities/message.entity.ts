import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../iam/entities/user.entity';
import { Channel } from './channel.entity';

export const MESSAGE_KINDS = [
  'TEXT',
  'FILE',
  'SYSTEM',
  'SITREP',
  'ESCALATION',
] as const;

export type MessageKind = (typeof MESSAGE_KINDS)[number];

@Entity({ name: 'messages', schema: 'chat' })
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'channel_id', type: 'uuid' })
  channelId: string;

  @ManyToOne(() => Channel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'channel_id' })
  channel: Channel;

  @Column({ name: 'sender_id', type: 'uuid' })
  senderId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'sender_id' })
  sender: User;

  @Column({ type: 'text', nullable: true })
  content: string | null;

  @Column({ type: 'text', default: 'TEXT' })
  kind: MessageKind;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId: string | null;

  @ManyToOne(() => Message, { nullable: true })
  @JoinColumn({ name: 'parent_id' })
  parent: Message | null;

  @Column({ name: 'file_id', type: 'uuid', nullable: true })
  fileId: string | null;

  @Column({ name: 'redacted_at', type: 'timestamptz', nullable: true })
  redactedAt: Date | null;

  @Column({ name: 'redacted_by', type: 'uuid', nullable: true })
  redactedBy: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'redacted_by' })
  redactor: User | null;

  @Column({ name: 'redact_reason', type: 'text', nullable: true })
  redactReason: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;
}
