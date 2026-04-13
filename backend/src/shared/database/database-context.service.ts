import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { DataSource, EntityManager, EntityTarget, Repository } from 'typeorm';

type DatabaseContextStore = {
  manager: EntityManager;
};

@Injectable()
export class DatabaseContextService {
  private readonly storage = new AsyncLocalStorage<DatabaseContextStore>();

  runWithManager<T>(manager: EntityManager, callback: () => T): T {
    return this.storage.run({ manager }, callback);
  }

  getManager(): EntityManager | undefined {
    return this.storage.getStore()?.manager;
  }

  getRepository<Entity extends object>(
    dataSource: DataSource,
    target: EntityTarget<Entity>,
  ): Repository<Entity> {
    const manager = this.getManager();
    return manager
      ? manager.getRepository(target)
      : dataSource.getRepository(target);
  }
}
