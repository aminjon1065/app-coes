import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService } from '../services/auth.service';
import { LoginDto } from '../dto/login.dto';
import { MfaVerifyDto } from '../dto/mfa.dto';
import { JwtAuthGuard } from '../../../shared/auth/jwt-auth.guard';
import { CurrentUser, type RequestUser } from '../../../shared/auth/current-user.decorator';
import { ConfigService } from '@nestjs/config';
import { Permissions } from '../../../shared/auth/permissions.decorator';
import { PermissionsGuard } from '../../../shared/auth/permissions.guard';
import { TenantAccessGuard } from '../../../shared/auth/tenant-access.guard';

const REFRESH_COOKIE = 'refresh_token';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email + password (+ TOTP when MFA enabled)' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? '';
    const ua = req.headers['user-agent'] ?? '';
    const tokens = await this.auth.login(dto, ip, ua);

    this.setRefreshCookie(res, tokens.refreshToken);

    return {
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
      tokenType: 'Bearer',
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Rotate access token using refresh cookie' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (!raw) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ message: 'No refresh token' });
    }
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? '';
    const ua = req.headers['user-agent'] ?? '';
    const tokens = await this.auth.refresh(raw, ip, ua);

    this.setRefreshCookie(res, tokens.refreshToken);
    return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn, tokenType: 'Bearer' };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, TenantAccessGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Revoke current session' })
  async logout(
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(user.sessionId);
    res.clearCookie(REFRESH_COOKIE);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard, TenantAccessGuard, PermissionsGuard)
  @ApiBearerAuth('access-token')
  @Permissions('iam.profile.read')
  @ApiOperation({ summary: 'Current session info and permissions' })
  async me(@CurrentUser() user: RequestUser) {
    return user;
  }

  // ── MFA ─────────────────────────────────────────────────────────────────────

  @Post('mfa/enroll')
  @UseGuards(JwtAuthGuard, TenantAccessGuard, PermissionsGuard)
  @ApiBearerAuth('access-token')
  @Permissions('iam.profile.manage')
  @ApiOperation({ summary: 'Start TOTP enrollment — returns otpauth:// URI' })
  async mfaEnroll(@CurrentUser() user: RequestUser) {
    return this.auth.enrollMfa(user.id);
  }

  @Post('mfa/verify')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, TenantAccessGuard, PermissionsGuard)
  @ApiBearerAuth('access-token')
  @Permissions('iam.profile.manage')
  @ApiOperation({ summary: 'Confirm TOTP code to activate MFA' })
  async mfaVerify(@CurrentUser() user: RequestUser, @Body() dto: MfaVerifyDto) {
    await this.auth.confirmMfa(user.id, dto.code);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private setRefreshCookie(res: Response, token: string) {
    const isSecure = this.config.get<string>('COOKIE_SECURE', 'false') === 'true';
    const sameSite = (this.config.get<string>('COOKIE_SAME_SITE', 'lax')) as 'lax' | 'strict' | 'none';
    const domain = this.config.get<string>('COOKIE_DOMAIN', 'localhost');

    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: isSecure,
      sameSite,
      domain,
      path: '/api/v1/auth',
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
    });
  }
}
