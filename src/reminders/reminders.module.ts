import { Global, Module } from '@nestjs/common';
import { RemindersService } from './reminders.service';

/**
 * Producer module — mounted in the API container so EventsService /
 * InviteesService can enqueue jobs. The CONSUMER (worker.processor) lives
 * in a separate module so the API process doesn't accidentally start a
 * Worker on top of all its HTTP handlers.
 */
@Global()
@Module({
  providers: [RemindersService],
  exports: [RemindersService],
})
export class RemindersModule {}
