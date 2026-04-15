import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import * as path from 'node:path';
import sharp from 'sharp';
import { DataSource, IsNull, Repository } from 'typeorm';
import { RequestUser } from '../../../shared/auth/current-user.decorator';
import { DatabaseContextService } from '../../../shared/database/database-context.service';
import { User } from '../../iam/entities/user.entity';
import { FileEntity } from '../entities/file.entity';
import { FileVariantEntity } from '../entities/file-variant.entity';
import { FileScanService } from './file-scan.service';
import { MinioService } from './minio.service';

@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly databaseContext: DatabaseContextService,
    private readonly minio: MinioService,
    private readonly scanner: FileScanService,
    private readonly events: EventEmitter2,
    private readonly config: ConfigService,
  ) {}

  private get files(): Repository<FileEntity> {
    return this.databaseContext.getRepository(this.dataSource, FileEntity);
  }

  private get variants(): Repository<FileVariantEntity> {
    return this.databaseContext.getRepository(
      this.dataSource,
      FileVariantEntity,
    );
  }

  private get users(): Repository<User> {
    return this.databaseContext.getRepository(this.dataSource, User);
  }

  async upload(
    file: Express.Multer.File,
    actor: RequestUser,
  ): Promise<FileEntity> {
    if (!file?.buffer?.length) {
      throw new UnprocessableEntityException('FILE_BUFFER_REQUIRED');
    }

    await this.ensureUploader(actor);

    const checksumSha256 = createHash('sha256')
      .update(file.buffer)
      .digest('hex');
    const existing = await this.files.findOne({
      where: {
        tenantId: actor.tenantId,
        checksumSha256,
        deletedAt: IsNull(),
      },
    });

    if (existing) {
      return existing;
    }

    const scanStatus = await this.scanner.scan(file.buffer);
    if (scanStatus === 'INFECTED') {
      this.events.emit('file.scan_failed', {
        tenantId: actor.tenantId,
        actorId: actor.id,
        originalName: file.originalname,
        checksumSha256,
        reason: 'infected',
      });
      throw new ForbiddenException('FILE_INFECTED');
    }
    if (scanStatus === 'ERROR') {
      this.events.emit('file.scan_failed', {
        tenantId: actor.tenantId,
        actorId: actor.id,
        originalName: file.originalname,
        checksumSha256,
        reason: 'scan_error',
      });
      throw new UnprocessableEntityException('FILE_SCAN_ERROR');
    }

    const objectKey = this.buildObjectKey(actor.tenantId, file.originalname);
    const bucket = this.getFilesBucket();

    await this.minio.putObject(
      bucket,
      objectKey,
      file.buffer,
      file.size,
      file.mimetype,
    );

    const saved = await this.files.save(
      this.files.create({
        tenantId: actor.tenantId,
        originalName: file.originalname,
        contentType: file.mimetype || 'application/octet-stream',
        sizeBytes: String(file.size),
        storageBucket: bucket,
        storageKey: objectKey,
        checksumSha256,
        scanStatus: 'CLEAN',
        scanResultDetail: null,
        uploadedBy: actor.id,
      }),
    );

    this.events.emit('file.uploaded.v1', {
      fileId: saved.id,
      tenantId: saved.tenantId,
      actorId: actor.id,
      contentType: saved.contentType,
      sizeBytes: saved.sizeBytes,
    });

    if (this.isImage(file.mimetype)) {
      void this.createThumbnailVariant(saved, file.buffer);
    }

    return saved;
  }

  async getPresignedUrl(fileId: string, actor: RequestUser): Promise<string> {
    const file = await this.findVisibleFile(fileId, actor.tenantId);

    if (file.scanStatus !== 'CLEAN') {
      throw new UnprocessableEntityException('FILE_NOT_AVAILABLE');
    }

    return this.minio.presignedGetUrl(
      file.storageBucket,
      file.storageKey,
      3600,
    );
  }

  async softDelete(fileId: string, actor: RequestUser): Promise<void> {
    const file = await this.findVisibleFile(fileId, actor.tenantId);

    const canDelete =
      file.uploadedBy === actor.id ||
      actor.roles.some((role) =>
        [
          'tenant_admin',
          'platform_admin',
          'shift_lead',
          'incident_commander',
        ].includes(role),
      );

    if (!canDelete) {
      throw new ForbiddenException('FILE_DELETE_FORBIDDEN');
    }

    file.deletedAt = new Date();
    await this.files.save(file);

    await this.minio
      .removeObject(file.storageBucket, file.storageKey)
      .catch((error: Error) => {
        this.logger.warn(
          `Failed to remove object ${file.storageKey}: ${error.message}`,
        );
      });

    const variants = await this.variants.find({ where: { fileId } });
    for (const variant of variants) {
      await this.minio
        .removeObject(variant.storageBucket, variant.storageKey)
        .catch((error: Error) => {
          this.logger.warn(
            `Failed to remove variant ${variant.storageKey}: ${error.message}`,
          );
        });
    }

    this.events.emit('file.deleted.v1', {
      fileId: file.id,
      tenantId: file.tenantId,
      actorId: actor.id,
    });
  }

  private async ensureUploader(actor: RequestUser) {
    const user = await this.users.findOne({
      where: { id: actor.id, tenantId: actor.tenantId, status: 'active' },
      select: { id: true },
    });

    if (!user) {
      throw new ForbiddenException('FILE_UPLOAD_FORBIDDEN');
    }
  }

  private async findVisibleFile(
    fileId: string,
    tenantId: string,
  ): Promise<FileEntity> {
    const file = await this.files.findOne({
      where: {
        id: fileId,
        tenantId,
        deletedAt: IsNull(),
      },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    return file;
  }

  private buildObjectKey(tenantId: string, originalName: string) {
    const now = new Date();
    const ext = path.extname(originalName).toLowerCase();
    const year = String(now.getUTCFullYear());
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');

    return `${tenantId}/${year}/${month}/${randomUUID()}${ext}`;
  }

  private getFilesBucket() {
    return this.config.get<string>('MINIO_FILES_BUCKET', 'coescd-dev-files');
  }

  private getMediaBucket() {
    return this.config.get<string>('MINIO_MEDIA_BUCKET', 'coescd-dev-media');
  }

  private isImage(contentType?: string | null) {
    return typeof contentType === 'string' && contentType.startsWith('image/');
  }

  private async createThumbnailVariant(
    file: FileEntity,
    buffer: Buffer,
  ): Promise<void> {
    try {
      const output = await sharp(buffer)
        .resize({
          width: 320,
          height: 320,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 82 })
        .toBuffer();

      const bucket = this.getMediaBucket();
      const key = `${file.tenantId}/thumbnails/${file.id}.jpg`;

      await this.minio.putObject(
        bucket,
        key,
        output,
        output.length,
        'image/jpeg',
      );
      await this.variants.save(
        this.variants.create({
          fileId: file.id,
          variantType: 'thumbnail',
          storageBucket: bucket,
          storageKey: key,
          sizeBytes: String(output.length),
        }),
      );

      this.events.emit('file.thumbnail_created.v1', {
        fileId: file.id,
        tenantId: file.tenantId,
        variantType: 'thumbnail',
      });
    } catch (error) {
      this.logger.warn(
        `Thumbnail generation failed for file ${file.id}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}
