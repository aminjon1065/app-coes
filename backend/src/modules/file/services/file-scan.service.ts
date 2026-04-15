import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as net from 'node:net';

export type ScanResult = 'CLEAN' | 'INFECTED' | 'ERROR';

@Injectable()
export class FileScanService {
  private readonly logger = new Logger(FileScanService.name);

  constructor(private readonly config: ConfigService) {}

  async scan(buffer: Buffer): Promise<ScanResult> {
    const host = this.config.get<string>('CLAMD_HOST', 'localhost');
    const port = this.config.get<number>('CLAMD_PORT', 3310);
    const timeoutMs = this.config.get<number>('CLAMD_TIMEOUT_MS', 30_000);

    return new Promise<ScanResult>((resolve) => {
      const socket = net.createConnection({ host, port });
      const chunks: Buffer[] = [];
      let settled = false;

      const finalize = (result: ScanResult) => {
        if (settled) {
          return;
        }
        settled = true;
        socket.destroy();
        resolve(result);
      };

      socket.setTimeout(timeoutMs);

      socket.on('connect', () => {
        socket.write('zINSTREAM\0');

        let offset = 0;
        const chunkSize = 64 * 1024;

        while (offset < buffer.length) {
          const chunk = buffer.subarray(offset, Math.min(offset + chunkSize, buffer.length));
          const sizePrefix = Buffer.alloc(4);
          sizePrefix.writeUInt32BE(chunk.length, 0);
          socket.write(sizePrefix);
          socket.write(chunk);
          offset += chunk.length;
        }

        socket.write(Buffer.alloc(4));
      });

      socket.on('data', (chunk) => {
        chunks.push(chunk);
      });

      socket.on('timeout', () => {
        this.logger.warn('ClamAV scan timed out');
        finalize('ERROR');
      });

      socket.on('error', (error) => {
        this.logger.warn(`ClamAV scan failed: ${error.message}`);
        finalize('ERROR');
      });

      socket.on('end', () => {
        const response = Buffer.concat(chunks).toString('utf8').trim();
        if (response.includes('OK')) {
          finalize('CLEAN');
          return;
        }
        if (response.includes('FOUND')) {
          finalize('INFECTED');
          return;
        }
        finalize('ERROR');
      });
    });
  }
}
