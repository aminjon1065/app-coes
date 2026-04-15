import {
  Inject,
  Injectable,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import * as argon2 from 'argon2';
import { User } from '../entities/user.entity';
import { Tenant } from '../entities/tenant.entity';
import { CreateUserDto } from '../dto/create-user.dto';
import { DatabaseContextService } from '../../../shared/database/database-context.service';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly databaseContext: DatabaseContextService,
  ) {}

  private get users(): Repository<User> {
    return this.databaseContext.getRepository(this.dataSource, User);
  }

  private get tenants(): Repository<Tenant> {
    return this.databaseContext.getRepository(this.dataSource, Tenant);
  }

  async create(tenantId: string, dto: CreateUserDto): Promise<User> {
    const exists = await this.users.findOne({
      where: { email: dto.email.toLowerCase() },
    });
    if (exists) throw new ConflictException('Email already registered');

    const tenant = await this.tenants.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 4,
    });

    const user = this.users.create({
      tenantId,
      email: dto.email.toLowerCase(),
      fullName: dto.fullName,
      phone: dto.phone ?? null,
      passwordHash,
      clearance: dto.clearance ?? 1,
      status: 'active',
    });
    return this.users.save(user);
  }

  async findAll(tenantId: string): Promise<User[]> {
    return this.users.find({
      where: { tenantId },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        clearance: true,
        status: true,
        mfaEnabled: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
  }

  async findOne(tenantId: string, id: string): Promise<User> {
    const user = await this.users.findOne({
      where: { id, tenantId },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        clearance: true,
        status: true,
        mfaEnabled: true,
        lastLoginAt: true,
        createdAt: true,
        tenantId: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async disable(tenantId: string, id: string): Promise<void> {
    const result = await this.users.update(
      { id, tenantId },
      { status: 'disabled' },
    );
    if (!result.affected) throw new NotFoundException('User not found');
  }

  async softDelete(tenantId: string, id: string): Promise<void> {
    const result = await this.users.softDelete({ id, tenantId });
    if (!result.affected) throw new NotFoundException('User not found');
  }
}
