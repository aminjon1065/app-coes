import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../../shared/auth/current-user.decorator';
import type { RequestUser } from '../../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/auth/jwt-auth.guard';
import { Permissions } from '../../../shared/auth/permissions.decorator';
import { PermissionsGuard } from '../../../shared/auth/permissions.guard';
import { Roles } from '../../../shared/auth/roles.decorator';
import { RolesGuard } from '../../../shared/auth/roles.guard';
import { TenantAccessGuard } from '../../../shared/auth/tenant-access.guard';
import { UploadFileDto } from '../dto/upload-file.dto';
import { FileService } from '../services/file.service';

const BLOCKED_EXTENSIONS = ['.exe', '.bat', '.sh', '.ps1', '.cmd'];

@ApiTags('files')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, TenantAccessGuard, RolesGuard, PermissionsGuard)
@Controller('files')
export class FileController {
  constructor(private readonly files: FileService) {}

  @Post('upload')
  @ApiOperation({ summary: 'Upload a file with AV scan and MinIO storage' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadFileDto })
  @Roles(
    'duty_operator',
    'shift_lead',
    'incident_commander',
    'field_responder',
    'tenant_admin',
    'platform_admin',
  )
  @Permissions('file.upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 500 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const lower = file.originalname.toLowerCase();
        if (BLOCKED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
          cb(new BadRequestException('File type not allowed'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() actor: RequestUser,
  ) {
    return { data: await this.files.upload(file, actor) };
  }

  @Get(':id/url')
  @ApiOperation({ summary: 'Get a presigned download URL for a file' })
  @Roles(
    'duty_operator',
    'shift_lead',
    'incident_commander',
    'field_responder',
    'tenant_admin',
    'platform_admin',
  )
  async getDownloadUrl(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { url: await this.files.getPresignedUrl(id, actor) };
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Soft-delete a file and revoke storage access' })
  @Roles(
    'duty_operator',
    'shift_lead',
    'incident_commander',
    'field_responder',
    'tenant_admin',
    'platform_admin',
  )
  async deleteFile(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.files.softDelete(id, actor);
  }
}
