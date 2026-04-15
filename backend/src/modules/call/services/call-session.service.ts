import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RequestUser } from '../../../shared/auth/current-user.decorator';
import { ChannelService } from '../../chat/services/channel.service';
import { StartCallDto } from '../dto/start-call.dto';

export type CallParticipantState = {
  userId: string;
  joinedAt: string;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenEnabled: boolean;
};

type InternalParticipantState = CallParticipantState & {
  socketIds: Set<string>;
};

export type CallSessionState = {
  id: string;
  tenantId: string;
  channelId: string | null;
  incidentId: string | null;
  title: string | null;
  status: 'active' | 'ended';
  startedBy: string;
  startedAt: string;
  endedAt: string | null;
  participants: CallParticipantState[];
};

@Injectable()
export class CallSessionService {
  private readonly sessions = new Map<
    string,
    Omit<CallSessionState, 'participants'> & {
      participants: Map<string, InternalParticipantState>;
    }
  >();

  constructor(private readonly channels: ChannelService) {}

  async start(
    actor: RequestUser,
    dto: StartCallDto,
  ): Promise<CallSessionState> {
    if (!dto.channelId && !dto.incidentId) {
      throw new UnprocessableEntityException('CALL_SCOPE_REQUIRED');
    }

    if (dto.channelId) {
      const isMember = await this.channels.isMember(dto.channelId, actor.id);
      if (!isMember) {
        throw new ForbiddenException('CALL_CHANNEL_ACCESS_DENIED');
      }

      const existing = Array.from(this.sessions.values()).find(
        (session) =>
          session.status === 'active' &&
          session.tenantId === actor.tenantId &&
          session.channelId === dto.channelId,
      );

      if (existing) {
        return this.toExternalSession(existing);
      }
    }

    const id = randomUUID();
    const session = {
      id,
      tenantId: actor.tenantId,
      channelId: dto.channelId ?? null,
      incidentId: dto.incidentId ?? null,
      title: dto.title?.trim() ?? null,
      status: 'active' as const,
      startedBy: actor.id,
      startedAt: new Date().toISOString(),
      endedAt: null,
      participants: new Map<string, InternalParticipantState>(),
    };

    this.sessions.set(id, session);
    return this.toExternalSession(session);
  }

  async findAccessible(
    actor: RequestUser,
    callId: string,
  ): Promise<CallSessionState> {
    const session = this.sessions.get(callId);
    if (!session || session.status !== 'active') {
      throw new NotFoundException('Call not found');
    }
    if (session.tenantId !== actor.tenantId) {
      throw new ForbiddenException('CALL_ACCESS_DENIED');
    }
    if (session.channelId) {
      const isMember = await this.channels.isMember(
        session.channelId,
        actor.id,
      );
      if (!isMember) {
        throw new ForbiddenException('CALL_ACCESS_DENIED');
      }
    }

    return this.toExternalSession(session);
  }

  async join(
    actor: RequestUser,
    callId: string,
    socketId: string,
  ): Promise<CallSessionState> {
    const session = await this.getInternalAccessibleSession(actor, callId);
    const existing = session.participants.get(actor.id);

    if (existing) {
      existing.socketIds.add(socketId);
    } else {
      session.participants.set(actor.id, {
        userId: actor.id,
        joinedAt: new Date().toISOString(),
        audioEnabled: true,
        videoEnabled: true,
        screenEnabled: false,
        socketIds: new Set([socketId]),
      });
    }

    return this.toExternalSession(session);
  }

  async leave(
    actor: RequestUser,
    callId: string,
    socketId: string,
  ): Promise<CallSessionState | null> {
    const session = await this.getInternalAccessibleSession(actor, callId);
    const participant = session.participants.get(actor.id);

    if (!participant) {
      return this.toExternalSession(session);
    }

    participant.socketIds.delete(socketId);

    if (participant.socketIds.size === 0) {
      session.participants.delete(actor.id);
    }

    if (session.participants.size === 0) {
      session.status = 'ended';
      session.endedAt = new Date().toISOString();
      return null;
    }

    return this.toExternalSession(session);
  }

  async leaveAllForSocket(
    actor: RequestUser,
    socketId: string,
  ): Promise<Array<{ callId: string; session: CallSessionState | null }>> {
    const results: Array<{ callId: string; session: CallSessionState | null }> =
      [];

    for (const session of this.sessions.values()) {
      if (session.tenantId !== actor.tenantId || session.status !== 'active') {
        continue;
      }
      const participant = session.participants.get(actor.id);
      if (!participant?.socketIds.has(socketId)) {
        continue;
      }

      participant.socketIds.delete(socketId);
      if (participant.socketIds.size === 0) {
        session.participants.delete(actor.id);
      }

      if (session.participants.size === 0) {
        session.status = 'ended';
        session.endedAt = new Date().toISOString();
        results.push({ callId: session.id, session: null });
      } else {
        results.push({
          callId: session.id,
          session: this.toExternalSession(session),
        });
      }
    }

    return results;
  }

  async updateParticipantState(
    actor: RequestUser,
    callId: string,
    patch: Partial<
      Pick<
        CallParticipantState,
        'audioEnabled' | 'videoEnabled' | 'screenEnabled'
      >
    >,
  ): Promise<CallSessionState> {
    const session = await this.getInternalAccessibleSession(actor, callId);
    const participant = session.participants.get(actor.id);
    if (!participant) {
      throw new ForbiddenException('CALL_JOIN_REQUIRED');
    }

    if (typeof patch.audioEnabled === 'boolean') {
      participant.audioEnabled = patch.audioEnabled;
    }
    if (typeof patch.videoEnabled === 'boolean') {
      participant.videoEnabled = patch.videoEnabled;
    }
    if (typeof patch.screenEnabled === 'boolean') {
      participant.screenEnabled = patch.screenEnabled;
    }

    return this.toExternalSession(session);
  }

  private async getInternalAccessibleSession(
    actor: RequestUser,
    callId: string,
  ) {
    const session = this.sessions.get(callId);
    if (!session || session.status !== 'active') {
      throw new NotFoundException('Call not found');
    }
    if (session.tenantId !== actor.tenantId) {
      throw new ForbiddenException('CALL_ACCESS_DENIED');
    }
    if (session.channelId) {
      const isMember = await this.channels.isMember(
        session.channelId,
        actor.id,
      );
      if (!isMember) {
        throw new ForbiddenException('CALL_ACCESS_DENIED');
      }
    }
    return session;
  }

  private toExternalSession(
    session: Omit<CallSessionState, 'participants'> & {
      participants: Map<string, InternalParticipantState>;
    },
  ): CallSessionState {
    return {
      id: session.id,
      tenantId: session.tenantId,
      channelId: session.channelId,
      incidentId: session.incidentId,
      title: session.title,
      status: session.status,
      startedBy: session.startedBy,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      participants: Array.from(session.participants.values()).map(
        ({ socketIds: _socketIds, ...participant }) => participant,
      ),
    };
  }
}
