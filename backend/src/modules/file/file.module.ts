import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '../../shared/database/database.module';
import { User } from '../iam/entities/user.entity';
import { FileController } from './controllers/file.controller';
import { FileVariantEntity } from './entities/file-variant.entity';
import { FileEntity } from './entities/file.entity';
import { FileScanService } from './services/file-scan.service';
import { FileService } from './services/file.service';
import { MinioService } from './services/minio.service';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    TypeOrmModule.forFeature([FileEntity, FileVariantEntity, User]),
  ],
  providers: [FileService, MinioService, FileScanService],
  controllers: [FileController],
  exports: [FileService, MinioService],
})
export class FileModule {}
