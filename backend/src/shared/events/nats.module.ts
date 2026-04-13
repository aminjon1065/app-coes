import {
  Global,
  Inject,
  Logger,
  Module,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect, NatsConnection, JetStreamClient, JetStreamManager, RetentionPolicy, StorageType } from 'nats';

export const NATS_CONNECTION = 'NATS_CONNECTION';
export const NATS_JETSTREAM = 'NATS_JETSTREAM';

// Stream definitions — match NATS_STREAM_* env vars
const STREAM_CONFIGS = [
  { name: 'STREAM_IAM',          subjects: ['iam.>'],          description: 'IAM events' },
  { name: 'STREAM_INCIDENT',     subjects: ['incident.>'],     description: 'Incident domain events' },
  { name: 'STREAM_TASK',         subjects: ['task.>'],         description: 'Task domain events' },
  { name: 'STREAM_CHAT',         subjects: ['chat.>'],         description: 'Chat & call events' },
  { name: 'STREAM_FILE',         subjects: ['file.>'],         description: 'File lifecycle events' },
  { name: 'STREAM_GEO',          subjects: ['geo.>'],          description: 'GIS feature events' },
  { name: 'STREAM_NOTIFICATION', subjects: ['notification.>'], description: 'Notification dispatch events' },
  { name: 'STREAM_ANALYTICS',    subjects: ['analytics.>'],    description: 'Analytics ETL events' },
  { name: 'STREAM_AUDIT',        subjects: ['audit.>'],        description: 'Audit trail events' },
] as const;

@Global()
@Module({
  providers: [
    {
      provide: NATS_CONNECTION,
      inject: [ConfigService],
      useFactory: async (config: ConfigService): Promise<NatsConnection> => {
        const servers = config.get<string>('NATS_URL', 'nats://localhost:4222');
        const user = config.get<string>('NATS_USER') || undefined;
        const pass = config.get<string>('NATS_PASSWORD') || undefined;

        const nc = await connect({
          servers,
          ...(user && pass ? { user, pass } : {}),
          reconnect: true,
          maxReconnectAttempts: -1,
          reconnectTimeWait: 2_000,
          pingInterval: 20_000,
          name: 'coescd-api',
        });
        return nc;
      },
    },
    {
      provide: NATS_JETSTREAM,
      inject: [NATS_CONNECTION],
      useFactory: (nc: NatsConnection): JetStreamClient => nc.jetstream(),
    },
  ],
  exports: [NATS_CONNECTION, NATS_JETSTREAM],
})
export class NatsModule implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(NatsModule.name);

  // Use `any` to avoid TS1272 (isolatedModules + emitDecoratorMetadata)
  constructor(
    @Inject(NATS_CONNECTION) private readonly nc: any,
  ) {}

  async onApplicationBootstrap() {
    try {
      const jsm: JetStreamManager = await this.nc.jetstreamManager();
      for (const streamCfg of STREAM_CONFIGS) {
        try {
          await jsm.streams.info(streamCfg.name);
        } catch {
          // Stream doesn't exist — create it
          await jsm.streams.add({
            name: streamCfg.name,
            subjects: [...streamCfg.subjects],
            description: streamCfg.description,
            retention: RetentionPolicy.Limits,
            storage: StorageType.File,
            num_replicas: 1,
            max_msgs: 10_000_000,
            max_age: 7 * 24 * 60 * 60 * 1e9, // 7 days in nanoseconds
          });
          this.logger.log(`Created NATS stream: ${streamCfg.name}`);
        }
      }
    } catch (err) {
      this.logger.warn({ err }, 'NATS JetStream stream setup failed — running degraded');
    }
  }

  async onApplicationShutdown() {
    if (!this.nc.isClosed()) {
      await this.nc.drain();
    }
  }
}
