import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

// ── Injection tokens ──────────────────────────────────────────────────────────
// DB 0: PDP decisions, hot counters, general application cache
export const REDIS_CACHE = 'REDIS_CACHE';
// DB 1: Refresh token metadata, session revocation sets
export const REDIS_SESSIONS = 'REDIS_SESSIONS';
// DB 2: Token bucket state for rate limiting
export const REDIS_RATELIMIT = 'REDIS_RATELIMIT';
// DB 3: User online presence (sorted sets), typing indicators
export const REDIS_PRESENCE = 'REDIS_PRESENCE';

function createClient(config: ConfigService, db: number): Redis {
  return new Redis({
    host: config.get<string>('REDIS_HOST', 'localhost'),
    port: config.get<number>('REDIS_PORT', 6379),
    password: config.get<string>('REDIS_PASSWORD') || undefined,
    db,
    tls: config.get<string>('REDIS_TLS') === 'true' ? {} : undefined,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    retryStrategy: (times) => Math.min(times * 150, 5_000),
    lazyConnect: false,
  });
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CACHE,
      inject: [ConfigService],
      useFactory: (c: ConfigService) =>
        createClient(c, c.get<number>('REDIS_DB_CACHE', 0)),
    },
    {
      provide: REDIS_SESSIONS,
      inject: [ConfigService],
      useFactory: (c: ConfigService) =>
        createClient(c, c.get<number>('REDIS_DB_SESSIONS', 1)),
    },
    {
      provide: REDIS_RATELIMIT,
      inject: [ConfigService],
      useFactory: (c: ConfigService) =>
        createClient(c, c.get<number>('REDIS_DB_RATELIMIT', 2)),
    },
    {
      provide: REDIS_PRESENCE,
      inject: [ConfigService],
      useFactory: (c: ConfigService) =>
        createClient(c, c.get<number>('REDIS_DB_PRESENCE', 3)),
    },
  ],
  exports: [REDIS_CACHE, REDIS_SESSIONS, REDIS_RATELIMIT, REDIS_PRESENCE],
})
export class CacheModule {}
