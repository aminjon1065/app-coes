import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'minio';

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  private client: Client;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const endpointValue = this.config.get<string>(
      'MINIO_ENDPOINT',
      'localhost',
    );
    const parsed = this.parseEndpoint(endpointValue);

    this.client = new Client({
      endPoint: parsed.endPoint,
      port: parsed.port,
      useSSL: parsed.useSSL,
      accessKey: this.config.get<string>('MINIO_ACCESS_KEY', 'coescd'),
      secretKey: this.config.get<string>('MINIO_SECRET_KEY', 'coescd_dev'),
    });

    this.logger.log(
      `MinIO client initialized for ${parsed.useSSL ? 'https' : 'http'}://${parsed.endPoint}:${parsed.port}`,
    );
  }

  async putObject(
    bucket: string,
    key: string,
    body: Buffer,
    size: number,
    contentType: string,
  ): Promise<void> {
    await this.client.putObject(bucket, key, body, size, {
      'Content-Type': contentType,
    });
  }

  async presignedGetUrl(
    bucket: string,
    key: string,
    ttlSeconds = 3600,
  ): Promise<string> {
    return this.client.presignedGetObject(bucket, key, ttlSeconds);
  }

  async removeObject(bucket: string, key: string): Promise<void> {
    await this.client.removeObject(bucket, key);
  }

  private parseEndpoint(value: string) {
    if (value.startsWith('http://') || value.startsWith('https://')) {
      const url = new URL(value);
      return {
        endPoint: url.hostname,
        port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
        useSSL: url.protocol === 'https:',
      };
    }

    const [host, port] = value.split(':');

    return {
      endPoint: host,
      port: Number(port || 9000),
      useSSL: false,
    };
  }
}
