import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ChannelService } from '../services/channel.service';

type IncidentStatusChangedEvent = {
  tenantId: string;
  incidentId: string;
  actorId: string;
  after: string;
};

type IncidentParticipantEvent = {
  tenantId: string;
  incidentId: string;
  actorId: string;
};

@Injectable()
export class ChatIncidentListener {
  private readonly logger = new Logger(ChatIncidentListener.name);

  constructor(private readonly channels: ChannelService) {}

  @OnEvent('incident.status_changed', { async: true })
  async onIncidentStatusChanged(event: IncidentStatusChangedEvent) {
    if (event.after !== 'open') {
      return;
    }

    try {
      await this.channels.createInternal({
        tenantId: event.tenantId,
        incidentId: event.incidentId,
        type: 'INCIDENT_ROOM',
        name: `Incident Room`,
        description: 'Auto-created incident coordination channel',
        createdBy: event.actorId,
        memberIds: [],
        metadata: { autoCreated: true },
      });
      await this.channels.syncIncidentParticipants(
        event.tenantId,
        event.incidentId,
        event.actorId,
      );
    } catch (error) {
      this.logger.warn({ error, incidentId: event.incidentId }, 'Failed to create incident room');
    }
  }

  @OnEvent('incident.participant_added', { async: true })
  @OnEvent('incident.participant_removed', { async: true })
  @OnEvent('incident.commander_assigned', { async: true })
  async onIncidentMembershipChanged(event: IncidentParticipantEvent) {
    try {
      await this.channels.syncIncidentParticipants(
        event.tenantId,
        event.incidentId,
        event.actorId,
      );
    } catch (error) {
      this.logger.warn({ error, incidentId: event.incidentId }, 'Failed to sync incident room members');
    }
  }
}
