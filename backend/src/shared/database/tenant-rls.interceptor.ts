import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, from } from 'rxjs';
import { lastValueFrom } from 'rxjs';
import type { Request } from 'express';
import { DataSource } from 'typeorm';
import type { RequestUser } from '../auth/current-user.decorator';
import { DatabaseContextService } from './database-context.service';

type RequestWithUser = Request & { user?: RequestUser };

@Injectable()
export class TenantRlsInterceptor implements NestInterceptor {
  constructor(
    private readonly dataSource: DataSource,
    private readonly databaseContext: DatabaseContextService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const tenantId = request.user?.tenantId;
    const roles = request.user?.roles ?? [];

    if (!tenantId || roles.includes('platform_admin')) {
      return next.handle();
    }

    return from(this.executeWithinTenantTransaction(tenantId, next));
  }

  private async executeWithinTenantTransaction(
    tenantId: string,
    next: CallHandler,
  ): Promise<unknown> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.query('SET LOCAL app.tenant_id = $1', [tenantId]);

      const result = await this.databaseContext.runWithManager(
        queryRunner.manager,
        () => lastValueFrom(next.handle()),
      );

      await queryRunner.commitTransaction();
      return result;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
