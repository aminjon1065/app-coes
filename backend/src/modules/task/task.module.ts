import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../iam/entities/user.entity';
import { IncidentParticipant } from '../incident/entities/incident-participant.entity';
import { Incident } from '../incident/entities/incident.entity';
import { TasksController } from './controllers/tasks.controller';
import { TaskAssignmentHistory } from './entities/task-assignment-history.entity';
import { TaskComment } from './entities/task-comment.entity';
import { Task } from './entities/task.entity';
import { TasksService } from './services/tasks.service';
import { RealtimeEventsService } from '../../shared/events/realtime-events.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Task,
      TaskComment,
      TaskAssignmentHistory,
      Incident,
      IncidentParticipant,
      User,
    ]),
  ],
  controllers: [TasksController],
  providers: [TasksService, RealtimeEventsService],
  exports: [TypeOrmModule, TasksService],
})
export class TaskModule {}
