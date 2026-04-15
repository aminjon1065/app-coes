import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import pino from 'pino';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = pino({
    level: process.env.LOG_LEVEL ?? 'info',
    transport:
      process.env.NODE_ENV !== 'production'
        ? {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss' },
          }
        : undefined,
  });

  const app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });
  const config = app.get(ConfigService);

  // ── Security headers ─────────────────────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: config.get('NODE_ENV') === 'production',
      crossOriginEmbedderPolicy: config.get('NODE_ENV') === 'production',
    }),
  );

  // ── Compression ──────────────────────────────────────────────────────────────
  app.use(
    compression({
      filter: (req, res) => {
        const accept = req.headers.accept ?? '';
        if (
          typeof accept === 'string' &&
          accept.includes('text/event-stream')
        ) {
          return false;
        }
        return compression.filter(req, res);
      },
    }),
  );

  // ── Cookie parser ────────────────────────────────────────────────────────────
  app.use(
    cookieParser(config.get<string>('COOKIE_SECRET', 'dev-cookie-secret')),
  );

  // ── HTTP request logging ─────────────────────────────────────────────────────
  app.use(pinoHttp({ logger }));

  // ── CORS ─────────────────────────────────────────────────────────────────────
  const corsOrigins = config
    .get<string>('CORS_ORIGINS', 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim());
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      'X-Request-Id',
    ],
    exposedHeaders: ['X-Request-Id'],
  });

  // ── Global prefix ────────────────────────────────────────────────────────────
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'metrics'] });

  // ── Global validation pipe ───────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── Swagger / OpenAPI ────────────────────────────────────────────────────────
  if (config.get<string>('SWAGGER_ENABLED', 'true') !== 'false') {
    const swaggerDoc = new DocumentBuilder()
      .setTitle('CoESCD API')
      .setDescription('National Disaster Management Platform — REST API v1')
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'access-token',
      )
      .addCookieAuth('refresh_token')
      .addTag('auth', 'Authentication & sessions')
      .addTag('users', 'User management')
      .addTag('health', 'Health & readiness probes')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerDoc);
    SwaggerModule.setup(
      config.get<string>('SWAGGER_PATH', 'api/docs'),
      app,
      document,
      { swaggerOptions: { persistAuthorization: true } },
    );
  }

  // ── Start ─────────────────────────────────────────────────────────────────────
  const port = config.get<number>('APP_PORT_API', 3001);
  await app.listen(port, '0.0.0.0');
  logger.info({ port }, 'CoESCD API started');
}

bootstrap().catch((err) => {
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
