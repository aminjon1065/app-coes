import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MinioService } from '../file/services/minio.service';
import { Role } from '../iam/entities/role.entity';
import { UserRole } from '../iam/entities/user-role.entity';
import { User } from '../iam/entities/user.entity';
import { IncidentParticipant } from '../incident/entities/incident-participant.entity';
import { Incident } from '../incident/entities/incident.entity';
import { DocumentsController } from './controllers/documents.controller';
import { DocumentApproval } from './entities/document-approval.entity';
import { DocumentEntity } from './entities/document.entity';
import { DocumentVersion } from './entities/document-version.entity';
import { DocumentService } from './services/document.service';
import { PdfRenderService } from './services/pdf-render.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      DocumentEntity,
      DocumentVersion,
      DocumentApproval,
      Incident,
      IncidentParticipant,
      User,
      UserRole,
      Role,
    ]),
  ],
  controllers: [DocumentsController],
  providers: [DocumentService, PdfRenderService, MinioService],
  exports: [DocumentService],
})
export class DocumentModule {}
