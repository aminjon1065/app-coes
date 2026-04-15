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
import { ChannelService } from '../services/channel.service';
import { JwtPayload } from '../../iam/services/auth.service';

type SocketUser = {
  id: string;
  tenantId: string;
  roles: string[];
  clearance: number;
  sessionId: string;
};

@Injectable()
@WebSocketGateway({
  namespace: '/chat',
  cors: { origin: process.env.FRONTEND_URL ?? process.env.CORS_ORIGINS ?? '*' },
})
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly channels: ChannelService,
    @Inject(REDIS_CACHE) private readonly redis: Redis,
  ) {}

  afterInit(server: Server) {
    try {
      const subClient = this.redis.duplicate();
      server.adapter(createAdapter(this.redis as any, subClient as any));
    } catch (error) {
      this.logger.warn({ error }, 'Failed to enable chat Redis adapter');
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
      const user: SocketUser = {
        id: payload.sub,
        tenantId: payload.tid,
        roles: payload.roles ?? [],
        clearance: payload.clearance ?? 1,
        sessionId: payload.sessionId,
      };

      client.data.user = user;
      client.join(`user:${user.id}`);
      client.join(`tenant:${user.tenantId}`);

      const channelIds = await this.channels.getMembershipChannelIds(
        user.id,
        user.tenantId,
      );
      channelIds.forEach((channelId) => client.join(`channel:${channelId}`));
    } catch (error) {
      this.logger.warn({ error }, 'Chat socket auth failed');
      client.disconnect(true);
    }
  }

  handleDisconnect(_client: Socket) {}

  @SubscribeMessage('join_channel')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() channelId: string,
  ) {
    const user = this.getSocketUser(client);
    const isMember = await this.channels.isMember(channelId, user.id);
    if (!isMember) {
      throw new WsException('CHANNEL_ACCESS_DENIED');
    }

    await client.join(`channel:${channelId}`);
    return { ok: true };
  }

  @SubscribeMessage('typing_start')
  async handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() channelId: string,
  ) {
    const user = this.getSocketUser(client);
    const isMember = await this.channels.isMember(channelId, user.id);
    if (!isMember) {
      throw new WsException('CHANNEL_ACCESS_DENIED');
    }

    client.to(`channel:${channelId}`).emit('typing.start', {
      userId: user.id,
      channelId,
    });
    return { ok: true };
  }

  @SubscribeMessage('typing_stop')
  async handleTypingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() channelId: string,
  ) {
    const user = this.getSocketUser(client);
    const isMember = await this.channels.isMember(channelId, user.id);
    if (!isMember) {
      throw new WsException('CHANNEL_ACCESS_DENIED');
    }

    client.to(`channel:${channelId}`).emit('typing.stop', {
      userId: user.id,
      channelId,
    });
    return { ok: true };
  }

  emitMessageNew(message: { channelId: string }) {
    this.server.to(`channel:${message.channelId}`).emit('message.new', message);
  }

  emitMessageRedacted(message: { channelId: string }) {
    this.server.to(`channel:${message.channelId}`).emit('message.redacted', message);
  }

  emitReactionChanged(channelId: string, messageId: string, reactions: unknown[]) {
    this.server.to(`channel:${channelId}`).emit('message.reactions', {
      channelId,
      messageId,
      reactions,
    });
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
