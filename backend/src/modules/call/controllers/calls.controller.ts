import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type RequestUser,
} from '../../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/auth/jwt-auth.guard';
import { TenantAccessGuard } from '../../../shared/auth/tenant-access.guard';
import { StartCallDto } from '../dto/start-call.dto';
import { CallSessionService } from '../services/call-session.service';

@ApiTags('calls')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
@Controller('calls')
export class CallsController {
  constructor(private readonly calls: CallSessionService) {}

  @Post('start')
  @ApiOperation({
    summary: 'Start or reuse an active call for the given scope',
  })
  async start(@CurrentUser() actor: RequestUser, @Body() dto: StartCallDto) {
    return { data: await this.calls.start(actor, dto) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get call session state' })
  async findOne(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.calls.findAccessible(actor, id) };
  }
}
