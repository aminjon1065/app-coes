import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { JwtPayload } from '../../modules/iam/services/auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET', 'dev-access-secret-min-32-chars-change-me'),
    });
  }

  async validate(payload: JwtPayload) {
    if (!payload.sub || !payload.tid) {
      throw new UnauthorizedException('Malformed token');
    }
    // Attach to request as req.user
    return {
      id: payload.sub,
      tenantId: payload.tid,
      roles: payload.roles ?? [],
      clearance: payload.clearance ?? 1,
      sessionId: payload.sessionId,
    };
  }
}
