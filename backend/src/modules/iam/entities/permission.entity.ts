import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'permissions', schema: 'iam' })
export class Permission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** e.g. incident.create, task.assign, audit.read */
  @Column({ unique: true, type: 'text' })
  code: string;

  @Column({ nullable: true, type: 'text' })
  description: string | null;
}
