import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UsersService } from '../services/users.service';
import { CreateUserDto } from '../dto/create-user.dto';
import { JwtAuthGuard } from '../../../shared/auth/jwt-auth.guard';
import { Permissions } from '../../../shared/auth/permissions.decorator';
import { PermissionsGuard } from '../../../shared/auth/permissions.guard';
import {
  CurrentUser,
  type RequestUser,
} from '../../../shared/auth/current-user.decorator';
import { Roles } from '../../../shared/auth/roles.decorator';
import { RolesGuard } from '../../../shared/auth/roles.guard';
import { TenantAccessGuard } from '../../../shared/auth/tenant-access.guard';

@ApiTags('users')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, TenantAccessGuard, RolesGuard, PermissionsGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  @ApiOperation({ summary: "Create a user in the calling user's tenant" })
  @Roles('tenant_admin', 'platform_admin')
  @Permissions('iam.users.create')
  create(@CurrentUser() caller: RequestUser, @Body() dto: CreateUserDto) {
    return this.users.create(caller.tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: "List users in the calling user's tenant" })
  @Roles('tenant_admin', 'shift_lead', 'platform_admin')
  @Permissions('iam.users.read')
  findAll(@CurrentUser() caller: RequestUser) {
    return this.users.findAll(caller.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a user by ID' })
  @Roles('tenant_admin', 'shift_lead', 'platform_admin')
  @Permissions('iam.users.read')
  findOne(
    @CurrentUser() caller: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.users.findOne(caller.tenantId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a user' })
  @Roles('tenant_admin', 'platform_admin')
  @Permissions('iam.users.delete')
  remove(
    @CurrentUser() caller: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.users.softDelete(caller.tenantId, id);
  }
}
