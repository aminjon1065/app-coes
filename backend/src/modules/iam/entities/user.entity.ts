import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  ManyToOne,
  JoinColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';

@Entity({ name: 'users', schema: 'iam' })
@Index('idx_users_tenant', ['tenantId'], { where: '"deleted_at" IS NULL' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  /** citext in DDL — store as lowercase at app layer */
  @Column({ unique: true, type: 'text' })
  email: string;

  @Column({ nullable: true, type: 'text' })
  phone: string | null;

  @Column({ name: 'full_name', type: 'text' })
  fullName: string;

  /** argon2id hash; null for SSO-only users */
  @Column({
    name: 'password_hash',
    nullable: true,
    type: 'text',
    select: false,
  })
  passwordHash: string | null;

  /** 1=PUBLIC 2=INTERNAL 3=CONFIDENTIAL 4=SECRET */
  @Column({ type: 'smallint', default: 1 })
  clearance: number;

  /** active | disabled | locked | pending */
  @Column({ type: 'text', default: 'active' })
  status: string;

  @Column({ name: 'last_login_at', nullable: true, type: 'timestamptz' })
  lastLoginAt: Date | null;

  @Column({ name: 'mfa_enabled', default: false })
  mfaEnabled: boolean;

  /** Arbitrary extensible JSON — used for mfa_secret, preferences, etc. */
  @Column({ type: 'jsonb', default: '{}', select: false })
  attributes: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
