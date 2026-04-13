import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from './user.entity';

@Entity({ name: 'sessions', schema: 'iam' })
@Index('idx_sessions_user_active', ['userId'], { where: '"revoked_at" IS NULL' })
export class Session {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** SHA-256 hash of the raw refresh token */
  @Column({ name: 'refresh_hash', type: 'text' })
  refreshHash: string;

  @Column({ name: 'user_agent', nullable: true, type: 'text' })
  userAgent: string | null;

  @Column({ nullable: true, type: 'inet' })
  ip: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'revoked_at', nullable: true, type: 'timestamptz' })
  revokedAt: Date | null;
}
