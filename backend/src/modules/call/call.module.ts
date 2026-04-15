import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { CacheModule } from '../../shared/cache/cache.module';
import { ChatModule } from '../chat/chat.module';
import { CallsController } from './controllers/calls.controller';
import { CallGateway } from './gateways/call.gateway';
import { CallSessionService } from './services/call-session.service';

@Module({
  imports: [
    ConfigModule,
    CacheModule,
    ChatModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>(
          'JWT_ACCESS_SECRET',
          'dev-access-secret-min-32-chars-change-me',
        ),
      }),
    }),
  ],
  controllers: [CallsController],
  providers: [CallSessionService, CallGateway],
  exports: [CallSessionService, CallGateway],
})
export class CallModule {}
