import { Injectable } from '@nestjs/common';
import { ChatGateway } from '../../chat/gateways/chat.gateway';
import { NotificationEntity } from '../entities/notification.entity';

@Injectable()
export class InAppService {
  constructor(private readonly chatGateway: ChatGateway) {}

  async deliver(notification: NotificationEntity): Promise<void> {
    this.chatGateway.server
      .to(`user:${notification.userId}`)
      .emit('notification.new', notification);
  }
}
