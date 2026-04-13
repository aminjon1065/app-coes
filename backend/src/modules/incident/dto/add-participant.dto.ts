import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsUUID } from 'class-validator';
import { INCIDENT_PARTICIPANT_ROLES } from '../entities/incident-participant.entity';

const ALLOWED_ADD_PARTICIPANT_ROLES = INCIDENT_PARTICIPANT_ROLES.filter(
  (role) => role !== 'commander',
);

export class AddParticipantDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  userId: string;

  @ApiProperty({ enum: ALLOWED_ADD_PARTICIPANT_ROLES })
  @IsEnum(ALLOWED_ADD_PARTICIPANT_ROLES)
  role: (typeof ALLOWED_ADD_PARTICIPANT_ROLES)[number];
}
