import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '../../shared/database/database.module';
import { IamModule } from '../iam/iam.module';
import { User } from '../iam/entities/user.entity';
import { IncidentParticipant } from '../incident/entities/incident-participant.entity';
import { Incident } from '../incident/entities/incident.entity';
import { Task } from '../task/entities/task.entity';
import { GisController } from './controllers/gis.controller';
import { MapFeature } from './entities/map-feature.entity';
import { MapLayer } from './entities/map-layer.entity';
import { GisService } from './services/gis.service';

@Module({
  imports: [
    DatabaseModule,
    IamModule,
    TypeOrmModule.forFeature([
      MapLayer,
      MapFeature,
      Incident,
      IncidentParticipant,
      Task,
      User,
    ]),
  ],
  controllers: [GisController],
  providers: [GisService],
  exports: [GisService],
})
export class GisModule {}
