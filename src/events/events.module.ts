import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { PastStateSchedulerService } from './past-state-scheduler.service';

@Module({
  controllers: [EventsController],
  // Phase 7·D — `PastStateSchedulerService` boots the hourly repeatable scan
  // job. Worker container owns the consumer side (see ReminderProcessor).
  providers: [EventsService, PastStateSchedulerService],
  exports: [EventsService],
})
export class EventsModule {}
