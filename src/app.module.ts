import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

import { validateEnv } from './config/env.validation';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './infra/redis/redis.module';
import { AuditModule } from './infra/audit/audit.module';
import { QueueModule } from './infra/queue/queue.module';
import { StorageModule } from './infra/storage/storage.module';
import { AiModule } from './infra/ai/ai.module';
import { RemindersModule } from './reminders/reminders.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { UsersModule } from './users/users.module';
import { TiersModule } from './tiers/tiers.module';
import { EventsModule } from './events/events.module';
import { SegmentsModule } from './segments/segments.module';
import { PaymentsModule } from './payments/payments.module';
import { RealtimeModule } from './realtime/realtime.module';
import { NotificationsModule } from './notifications/notifications.module';
import { MembersModule } from './members/members.module';
import { InviteesModule } from './invitees/invitees.module';
import { ShareModule } from './share/share.module';
import { BrandModule } from './brand/brand.module';
import { CopilotModule } from './copilot/copilot.module';
import { VibePackModule } from './vibe-pack/vibe-pack.module';
import { HolidayScannerModule } from './holiday-scanner/holiday-scanner.module';
import { ReviewsModule } from './reviews/reviews.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),

    // Phase 5.7·F — three named throttler scopes so routes can opt into a
    // tighter cap without losing the broad fallback. Better Auth's own
    // rateLimit handles `/api/auth/*` (those routes never reach this guard);
    // the names below are for everything else.
    //
    //   short  — burst protection on a single endpoint (`@Throttle({ short })`)
    //   medium — the default app-wide cap (every route inherits this)
    //   long   — sustained-pace ceiling, harder to hit through legit use
    //
    // Storage is in-memory; flip to a Redis-backed bucket when we go
    // multi-pod (slice 5.7·F-followup).
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 10_000, limit: 10 },
      { name: 'medium', ttl: 60_000, limit: 60 },
      { name: 'long', ttl: 10 * 60_000, limit: 200 },
    ]),

    PrismaModule,
    RedisModule,
    AuditModule,
    QueueModule,
    StorageModule,
    AiModule,
    RemindersModule,
    AuthModule,
    HealthModule,
    UsersModule,
    TiersModule,
    EventsModule,
    SegmentsModule,
    PaymentsModule,
    RealtimeModule,
    NotificationsModule,
    MembersModule,
    InviteesModule,
    ShareModule,
    BrandModule,
    CopilotModule,
    VibePackModule,
    HolidayScannerModule,
    ReviewsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  /**
   * `RequestIdMiddleware` stamps every request with `x-request-id` and pushes
   * it into the Sentry scope. Mounted on `*` so even auth + health routes are
   * correlatable. Better Auth routes (`/api/auth/*`) bypass the NestJS middleware
   * chain (they're handled by the Express adapter directly in main.ts) — those
   * fall back to the standard Better Auth request handling without a tagged id.
   * Phase 5.7·C will plumb the id through that path too if it matters.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
