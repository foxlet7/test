import { Global, Module } from '@nestjs/common';
import { ConsoleMessageProvider, MessageProvider, NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, { provide: MessageProvider, useClass: ConsoleMessageProvider }],
  exports: [NotificationsService],
})
export class NotificationsModule {}
