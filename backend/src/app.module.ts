import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from './shared/database/database.module';
import { CacheModule } from './shared/cache/cache.module';
import { NatsModule } from './shared/events/nats.module';
import { HealthModule } from './shared/health/health.module';
import { IamModule } from './modules/iam/iam.module';
import { IncidentModule } from './modules/incident/incident.module';

@Module({
  imports: [
    // ── Config (global, available everywhere via ConfigService) ──────────────
    ConfigModule.forRoot({
      isGlobal: true,
      expandVariables: true,
      cache: true,
    }),

    // ── Rate limiting ────────────────────────────────────────────────────────
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            name: 'read',
            ttl: config.get<number>('THROTTLE_TTL', 60_000),
            limit: config.get<number>('THROTTLE_LIMIT_READ', 600),
          },
        ],
      }),
    }),

    // ── In-process domain event bus ──────────────────────────────────────────
    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
      maxListeners: 30,
      verboseMemoryLeak: true,
    }),

    // ── Cron / scheduled jobs ─────────────────────────────────────────────────
    ScheduleModule.forRoot(),

    // ── Infrastructure ────────────────────────────────────────────────────────
    DatabaseModule,
    CacheModule,
    NatsModule,
    HealthModule,

    // ── Domain modules ────────────────────────────────────────────────────────
    IamModule,
    IncidentModule,
  ],
})
export class AppModule {}
