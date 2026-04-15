import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createAdapter } from '@socket.io/redis-adapter';
import type Redis from 'ioredis';
import { Server, Socket } from 'socket.io';
import { REDIS_CACHE } from '../../../shared/cache/cache.module';
import { JwtPayload } from '../../iam/services/auth.service';
import { CallSessionService } from '../services/call-session.service';

type SocketUser = {
  id: string;
  tenantId: string;
  roles: string[];
  clearance: number;
  sessionId: string;
};

@Injectable()
@WebSocketGateway({
  namespace: '/call',
  cors: { origin: process.env.FRONTEND_URL ?? process.env.CORS_ORIGINS ?? '*' },
})
export class CallGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(CallGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly calls: CallSessionService,
    @Inject(REDIS_CACHE) private readonly redis: Redis,
  ) {}

  afterInit(server: Server) {
    try {
      const subClient = this.redis.duplicate();
      server.adapter(createAdapter(this.redis as any, subClient as any));
    } catch (error) {
      this.logger.warn({ error }, 'Failed to enable call Redis adapter');
    }
  }

  async handleConnection(client: Socket) {
    const token = this.extractToken(client);
    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: this.config.get<string>(
          'JWT_ACCESS_SECRET',
          'dev-access-secret-min-32-chars-change-me',
        ),
      });
      client.data.user = {
        id: payload.sub,
        tenantId: payload.tid,
        roles: payload.roles ?? [],
        clearance: payload.clearance ?? 1,
        sessionId: payload.sessionId,
      } satisfies SocketUser;
      client.join(`user:${payload.sub}`);
      client.join(`tenant:${payload.tid}`);
    } catch (error) {
      this.logger.warn({ error }, 'Call socket auth failed');
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket) {
    const user = client.data.user as SocketUser | undefined;
    if (!user) {
      return;
    }

    const results = await this.calls.leaveAllForSocket(user, client.id);
    for (const result of results) {
      client.leave(`call:${result.callId}`);
      if (result.session) {
        this.server
          .to(`call:${result.callId}`)
          .emit('call.state', result.session);
        this.server.to(`call:${result.callId}`).emit('call.participant_left', {
          callId: result.callId,
          userId: user.id,
        });
      } else {
        this.server.to(`call:${result.callId}`).emit('call.ended', {
          callId: result.callId,
        });
      }
    }
  }

  @SubscribeMessage('call.join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { callId: string },
  ) {
    const user = this.getSocketUser(client);
    try {
      const session = await this.calls.join(user, payload.callId, client.id);
      await client.join(`call:${payload.callId}`);

      client.emit('call.state', session);
      client.to(`call:${payload.callId}`).emit('call.participant_joined', {
        callId: payload.callId,
        userId: user.id,
      });
      this.server.to(`call:${payload.callId}`).emit('call.state', session);
      return { ok: true };
    } catch (error) {
      throw new WsException(
        error instanceof Error ? error.message : 'CALL_JOIN_FAILED',
      );
    }
  }

  @SubscribeMessage('call.leave')
  async handleLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { callId: string },
  ) {
    const user = this.getSocketUser(client);
    try {
      const session = await this.calls.leave(user, payload.callId, client.id);
      await client.leave(`call:${payload.callId}`);

      if (session) {
        this.server.to(`call:${payload.callId}`).emit('call.participant_left', {
          callId: payload.callId,
          userId: user.id,
        });
        this.server.to(`call:${payload.callId}`).emit('call.state', session);
      } else {
        this.server.to(`call:${payload.callId}`).emit('call.ended', {
          callId: payload.callId,
        });
      }

      return { ok: true };
    } catch (error) {
      throw new WsException(
        error instanceof Error ? error.message : 'CALL_LEAVE_FAILED',
      );
    }
  }

  @SubscribeMessage('call.signal')
  async handleSignal(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      callId: string;
      targetUserId?: string;
      type: 'offer' | 'answer' | 'ice-candidate' | 'hangup';
      data: unknown;
    },
  ) {
    const user = this.getSocketUser(client);
    try {
      await this.calls.findAccessible(user, payload.callId);

      if (payload.targetUserId) {
        this.server.to(`user:${payload.targetUserId}`).emit('call.signal', {
          callId: payload.callId,
          fromUserId: user.id,
          type: payload.type,
          data: payload.data,
        });
      } else {
        client.to(`call:${payload.callId}`).emit('call.signal', {
          callId: payload.callId,
          fromUserId: user.id,
          type: payload.type,
          data: payload.data,
        });
      }

      return { ok: true };
    } catch (error) {
      throw new WsException(
        error instanceof Error ? error.message : 'CALL_SIGNAL_FAILED',
      );
    }
  }

  @SubscribeMessage('call.toggle')
  async handleToggle(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      callId: string;
      audioEnabled?: boolean;
      videoEnabled?: boolean;
      screenEnabled?: boolean;
    },
  ) {
    const user = this.getSocketUser(client);
    try {
      const session = await this.calls.updateParticipantState(
        user,
        payload.callId,
        {
          audioEnabled: payload.audioEnabled,
          videoEnabled: payload.videoEnabled,
          screenEnabled: payload.screenEnabled,
        },
      );
      this.server.to(`call:${payload.callId}`).emit('call.state', session);
      return { ok: true };
    } catch (error) {
      throw new WsException(
        error instanceof Error ? error.message : 'CALL_TOGGLE_FAILED',
      );
    }
  }

  private extractToken(client: Socket): string | null {
    const authToken =
      typeof client.handshake.auth?.token === 'string'
        ? client.handshake.auth.token
        : null;
    if (authToken) {
      return authToken.replace(/^Bearer\s+/i, '');
    }

    const header = client.handshake.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      return header.slice('Bearer '.length);
    }

    return null;
  }

  private getSocketUser(client: Socket): SocketUser {
    const user = client.data.user as SocketUser | undefined;
    if (!user) {
      throw new WsException('AUTH_REQUIRED');
    }
    return user;
  }
}
