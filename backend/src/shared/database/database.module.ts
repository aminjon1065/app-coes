import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DatabaseContextService } from './database-context.service';
import { TenantRlsInterceptor } from './tenant-rls.interceptor';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL', 'postgresql://postgres:dev@localhost:6432/coescd_dev'),
        ssl: config.get<string>('DATABASE_SSL') === 'true' ? { rejectUnauthorized: false } : false,
        // autoLoadEntities: each feature module registers its own entities
        // via TypeOrmModule.forFeature([...]) and NestJS picks them up here.
        autoLoadEntities: true,
        synchronize: false,
        poolSize: config.get<number>('DATABASE_POOL_MAX', 20),
        connectTimeoutMS: 10_000,
        extra: {
          idleTimeoutMillis: config.get<number>('DATABASE_IDLE_TIMEOUT', 600_000),
          statement_timeout: config.get<number>('DATABASE_STATEMENT_TIMEOUT', 30_000),
          application_name: 'coescd-api',
        },
        logging: config.get('NODE_ENV') === 'development' ? ['error', 'warn', 'schema'] : ['error'],
      }),
    }),
  ],
  providers: [
    DatabaseContextService,
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantRlsInterceptor,
    },
  ],
  exports: [TypeOrmModule, DatabaseContextService],
})
export class DatabaseModule {}
