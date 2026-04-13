import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'roles', schema: 'iam' })
export class Role {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** null = system-wide role */
  @Column({ name: 'tenant_id', nullable: true, type: 'uuid' })
  tenantId: string | null;

  /** e.g. duty_operator, shift_lead, incident_commander */
  @Column({ type: 'text' })
  code: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ nullable: true, type: 'text' })
  description: string | null;

  @Column({ name: 'is_system', default: false })
  isSystem: boolean;
}
