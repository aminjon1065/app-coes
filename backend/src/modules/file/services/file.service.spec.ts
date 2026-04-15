import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ForbiddenException } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import type { RequestUser } from '../../../shared/auth/current-user.decorator';
import { DatabaseContextService } from '../../../shared/database/database-context.service';
import { User } from '../../iam/entities/user.entity';
import { FileVariantEntity } from '../entities/file-variant.entity';
import { FileEntity } from '../entities/file.entity';
import { FileScanService } from './file-scan.service';
import { FileService } from './file.service';
import { MinioService } from './minio.service';

describe('FileService', () => {
  const actor: RequestUser = {
    id: 'user-1',
    tenantId: 'tenant-1',
    roles: ['duty_operator'],
    permissions: ['file.upload'],
    clearance: 2,
    sessionId: 'session-1',
  };

  let filesRepository: any;
  let variantsRepository: any;
  let usersRepository: any;
  let dataSource: any;
  let databaseContext: any;
  let minio: any;
  let scanner: any;
  let events: any;
  let config: any;
  let service: FileService;

  beforeEach(() => {
    filesRepository = {
      create: jest.fn((payload) => payload),
      save: jest.fn(),
      findOne: jest.fn(),
    };
    variantsRepository = {
      create: jest.fn((payload) => payload),
      save: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    };
    usersRepository = {
      findOne: jest.fn().mockResolvedValue({ id: actor.id }),
    };
    dataSource = { manager: {} } as DataSource;
    databaseContext = {
      getRepository: jest.fn((_source: DataSource, entity: unknown) => {
        if (entity === FileEntity) return filesRepository;
        if (entity === FileVariantEntity) return variantsRepository;
        if (entity === User) return usersRepository;
        return null;
      }),
    } as unknown as DatabaseContextService;
    minio = {
      putObject: jest.fn(),
      presignedGetUrl: jest.fn().mockResolvedValue('https://signed.example/file'),
      removeObject: jest.fn(),
    } as unknown as MinioService;
    scanner = {
      scan: jest.fn(),
    } as unknown as FileScanService;
    events = {
      emit: jest.fn(),
    } as unknown as EventEmitter2;
    config = {
      get: jest.fn((key: string, fallback?: string) => {
        if (key === 'MINIO_FILES_BUCKET') return 'coescd-dev-files';
        if (key === 'MINIO_MEDIA_BUCKET') return 'coescd-dev-media';
        return fallback;
      }),
    } as unknown as ConfigService;

    service = new FileService(
      dataSource,
      databaseContext,
      minio,
      scanner,
      events,
      config,
    );
  });

  it('returns an existing deduplicated file when checksum already exists', async () => {
    const existing = {
      id: 'file-1',
      tenantId: actor.tenantId,
      checksumSha256: 'same-hash',
      deletedAt: null,
    };
    filesRepository.findOne.mockResolvedValue(existing);

    const result = await service.upload(
      {
        originalname: 'photo.jpg',
        mimetype: 'image/jpeg',
        size: 12,
        buffer: Buffer.from('hello'),
      } as Express.Multer.File,
      actor,
    );

    expect(result).toBe(existing);
    expect(scanner.scan).not.toHaveBeenCalled();
    expect(minio.putObject).not.toHaveBeenCalled();
  });

  it('rejects infected files and emits scan failure event', async () => {
    filesRepository.findOne.mockResolvedValue(null);
    scanner.scan = jest.fn().mockResolvedValue('INFECTED');

    await expect(
      service.upload(
        {
          originalname: 'report.pdf',
          mimetype: 'application/pdf',
          size: 8,
          buffer: Buffer.from('payload'),
        } as Express.Multer.File,
        actor,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(events.emit).toHaveBeenCalledWith(
      'file.scan_failed',
      expect.objectContaining({ reason: 'infected' }),
    );
  });

  it('uploads a clean file, stores metadata, and emits upload event', async () => {
    filesRepository.findOne.mockResolvedValue(null);
    scanner.scan = jest.fn().mockResolvedValue('CLEAN');
    filesRepository.save.mockImplementation(async (payload: any) => ({
      id: 'file-1',
      deletedAt: null,
      ...payload,
    }));

    const result = await service.upload(
      {
        originalname: 'report.pdf',
        mimetype: 'application/pdf',
        size: 8,
        buffer: Buffer.from('payload'),
      } as Express.Multer.File,
      actor,
    );

    expect(result.id).toBe('file-1');
    expect(minio.putObject).toHaveBeenCalled();
    expect(filesRepository.save).toHaveBeenCalled();
    expect(events.emit).toHaveBeenCalledWith(
      'file.uploaded.v1',
      expect.objectContaining({ fileId: 'file-1' }),
    );
  });

  it('returns a presigned URL for a visible clean file', async () => {
    filesRepository.findOne.mockResolvedValue({
      id: 'file-1',
      tenantId: actor.tenantId,
      scanStatus: 'CLEAN',
      storageBucket: 'coescd-dev-files',
      storageKey: 'tenant-1/2026/04/file.pdf',
      deletedAt: null,
    });

    const result = await service.getPresignedUrl('file-1', actor);

    expect(result).toBe('https://signed.example/file');
    expect(filesRepository.findOne).toHaveBeenCalledWith({
      where: {
        id: 'file-1',
        tenantId: actor.tenantId,
        deletedAt: IsNull(),
      },
    });
  });
});
