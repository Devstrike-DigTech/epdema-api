import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './infra/redis/redis.module';
import { AuditModule } from './infra/audit/audit.module';
import { QueueModule } from './infra/queue/queue.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RemindersWorkerModule } from './reminders/reminders-worker.module';

/**
 * Minimal Nest application for the worker process. We pull in only what the
 * processor actually needs: Prisma (read invitees), Redis (BullMQ connection),
 * NotificationsModule (Resend), and the worker module that registers the
 * actual BullMQ consumer.
 *
 * We deliberately do NOT mount controllers, throttler, swagger, or auth here.
 * Workers don't serve HTTP; keeping them slim means fewer surprises on Railway.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    PrismaModule,
    RedisModule,
    AuditModule,
    QueueModule,
    NotificationsModule,
    RemindersWorkerModule,
  ],
})
export class WorkerAppModule {}
