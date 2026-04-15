import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '../../shared/database/database.module';
import { ChatModule } from '../chat/chat.module';
import { User } from '../iam/entities/user.entity';
import { IncidentParticipant } from '../incident/entities/incident-participant.entity';
import { Incident } from '../incident/entities/incident.entity';
import { Task } from '../task/entities/task.entity';
import { NotificationController } from './controllers/notification.controller';
import { NotificationPreference } from './entities/notification-preference.entity';
import { NotificationEntity } from './entities/notification.entity';
import { NotificationListener } from './listeners/notification.listener';
import { EmailService } from './services/email.service';
import { InAppService } from './services/in-app.service';
import { NotificationService } from './services/notification.service';

@Module({
  imports: [
    DatabaseModule,
    ChatModule,
    TypeOrmModule.forFeature([
      NotificationEntity,
      NotificationPreference,
      User,
      Incident,
      IncidentParticipant,
      Task,
    ]),
  ],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    EmailService,
    InAppService,
    NotificationListener,
  ],
  exports: [NotificationService],
})
export class NotificationModule {}
