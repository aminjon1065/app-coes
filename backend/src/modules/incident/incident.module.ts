import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '../../shared/database/database.module';
import { IamModule } from '../iam/iam.module';
import { User } from '../iam/entities/user.entity';
import { TaskModule } from '../task/task.module';
import { IncidentsController } from './controllers/incidents.controller';
import { IncidentParticipant } from './entities/incident-participant.entity';
import { IncidentTimelineEntry } from './entities/incident-timeline-entry.entity';
import { Incident } from './entities/incident.entity';
import { SituationReport } from './entities/situation-report.entity';
import { IncidentsService } from './services/incidents.service';
import { RealtimeEventsService } from '../../shared/events/realtime-events.service';

@Module({
  imports: [
    DatabaseModule,
    IamModule,
    TaskModule,
    TypeOrmModule.forFeature([
      Incident,
      IncidentParticipant,
      IncidentTimelineEntry,
      SituationReport,
      User,
    ]),
  ],
  controllers: [IncidentsController],
  providers: [IncidentsService, RealtimeEventsService],
  exports: [IncidentsService],
})
export class IncidentModule {}
