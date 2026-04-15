import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FileEntity } from '../file/entities/file.entity';
import { User } from '../iam/entities/user.entity';
import { IncidentParticipant } from '../incident/entities/incident-participant.entity';
import { Incident } from '../incident/entities/incident.entity';
import { ChannelsController } from './controllers/channels.controller';
import { ChannelMember } from './entities/channel-member.entity';
import { Channel } from './entities/channel.entity';
import { MessageReaction } from './entities/message-reaction.entity';
import { Message } from './entities/message.entity';
import { ChatGateway } from './gateways/chat.gateway';
import { ChatIncidentListener } from './listeners/chat-incident.listener';
import { ChannelService } from './services/channel.service';
import { MessageService } from './services/message.service';

@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>(
          'JWT_ACCESS_SECRET',
          'dev-access-secret-min-32-chars-change-me',
        ),
      }),
    }),
    TypeOrmModule.forFeature([
      Channel,
      ChannelMember,
      Message,
      MessageReaction,
      User,
      Incident,
      IncidentParticipant,
      FileEntity,
    ]),
  ],
  controllers: [ChannelsController],
  providers: [
    ChannelService,
    MessageService,
    ChatGateway,
    ChatIncidentListener,
  ],
  exports: [ChannelService, MessageService, ChatGateway],
})
export class ChatModule {}
