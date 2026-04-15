import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type RequestUser,
} from '../../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/auth/jwt-auth.guard';
import { Roles } from '../../../shared/auth/roles.decorator';
import { RolesGuard } from '../../../shared/auth/roles.guard';
import { PermissionsGuard } from '../../../shared/auth/permissions.guard';
import { TenantAccessGuard } from '../../../shared/auth/tenant-access.guard';
import { ActivateBreakGlassDto } from '../dto/break-glass.dto';
import { SecurityService } from '../services/security.service';

@ApiTags('iam')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, TenantAccessGuard, RolesGuard, PermissionsGuard)
@Controller('iam')
export class SecurityController {
  constructor(private readonly security: SecurityService) {}

  @Post('break-glass')
  @HttpCode(HttpStatus.CREATED)
  @Roles('platform_admin', 'shift_lead')
  @ApiOperation({
    summary: 'Temporarily grant an elevated role to another user',
  })
  async activateBreakGlass(
    @CurrentUser() actor: RequestUser,
    @Body() dto: ActivateBreakGlassDto,
  ) {
    return {
      data: await this.security.activateBreakGlass(actor, dto),
    };
  }
}
