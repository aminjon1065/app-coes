import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '../../shared/database/database.module';
import { IamModule } from '../iam/iam.module';
import { AuditController } from './controllers/audit.controller';
import { AuditEventEntity } from './entities/audit-event.entity';
import { AuditListener } from './listeners/audit.listener';
import { AuditService } from './services/audit.service';

@Module({
  imports: [
    DatabaseModule,
    IamModule,
    TypeOrmModule.forFeature([AuditEventEntity]),
  ],
  controllers: [AuditController],
  providers: [AuditService, AuditListener],
  exports: [AuditService],
})
export class AuditModule {}
