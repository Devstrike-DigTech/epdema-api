import { Module } from '@nestjs/common';
import { ReminderProcessor } from './reminder.processor';

/**
 * Worker-only module. Mounted from worker.module.ts; NOT from app.module.ts.
 * Registers the BullMQ Worker that consumes jobs and sends emails.
 */
@Module({
  providers: [ReminderProcessor],
})
export class RemindersWorkerModule {}
