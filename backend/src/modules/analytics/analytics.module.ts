import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsController } from './controllers/analytics.controller';
import { FactIncident } from './entities/fact-incident.entity';
import { FactTask } from './entities/fact-task.entity';
import { AnalyticsListener } from './listeners/analytics.listener';
import { AnalyticsEtlService } from './services/analytics-etl.service';
import { AnalyticsService } from './services/analytics.service';

@Module({
  imports: [TypeOrmModule.forFeature([FactIncident, FactTask])],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsEtlService, AnalyticsListener],
  exports: [AnalyticsService, AnalyticsEtlService],
})
export class AnalyticsModule {}
