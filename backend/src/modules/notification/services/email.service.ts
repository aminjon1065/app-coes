import { Injectable, Logger } from '@nestjs/common';
import { NotificationEntity } from '../entities/notification.entity';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  async queue(notification: NotificationEntity): Promise<void> {
    this.logger.debug(
      {
        notificationId: notification.id,
        userId: notification.userId,
        eventType: notification.eventType,
      },
      'Queued notification email',
    );
  }
}
