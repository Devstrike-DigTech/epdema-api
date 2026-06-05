import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';
import Redis from 'ioredis';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../infra/audit/audit.service';
import { ResendAdapter } from '../notifications/resend.adapter';
import { renderRsvpNudgeEmail } from '../notifications/rsvp-nudge.template';
import { renderEventTomorrowEmail } from '../notifications/event-tomorrow.template';
import { JOB_NAMES, QUEUE_NAME } from '../infra/queue/queue.constants';

/**
 * BullMQ consumer. Owns its own Redis connection (BullMQ docs are emphatic
 * about not sharing). Each handler is self-contained and idempotent —
 * if the job fires twice (BullMQ retry, manual replay) the worst outcome is
 * a duplicate email, never a crashed worker.
 *
 * Lives in the worker process only; not registered in the API container.
 */
@Injectable()
export class ReminderProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReminderProcessor.name);
  private worker!: Worker;
  private connection!: Redis;
  private webOrigin!: string;
  private apiOrigin!: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly resend: ResendAdapter,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const url = this.config.getOrThrow<string>('REDIS_URL');
    this.connection = new Redis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    this.webOrigin = this.config.getOrThrow<string>('WEB_ORIGIN');
    this.apiOrigin = this.config.get<string>('API_ORIGIN') ?? 'http://localhost:3001';

    this.worker = new Worker(
      QUEUE_NAME,
      async (job) => this.dispatch(job),
      { connection: this.connection, concurrency: 8 },
    );

    this.worker.on('completed', (job) => {
      this.logger.log(`✓ ${job.name} ${job.id}`);
    });
    this.worker.on('failed', (job, err) => {
      this.logger.warn(`✗ ${job?.name} ${job?.id}: ${err.message}`);
    });
    this.logger.log(`Worker subscribed to "${QUEUE_NAME}"`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.connection?.quit();
  }

  // ────────────────────────────────────────────────────────────────────

  private async dispatch(job: Job): Promise<void> {
    switch (job.name) {
      case JOB_NAMES.rsvpNudge:
        await this.handleRsvpNudge(job);
        return;
      case JOB_NAMES.eventTomorrow:
        await this.handleEventTomorrow(job);
        return;
      case JOB_NAMES.pastStateScan:
        await this.handlePastStateScan(job);
        return;
      default:
        this.logger.warn(`Unknown job name "${job.name}" — skipping`);
    }
  }

  /**
   * Phase 7·D — sweep `published` events whose scheduled date has passed
   * and flip them to `past`. Runs hourly via the repeatable scheduler.
   *
   * Per-event guards live in `markPastSystem` (state + date checks), so a
   * race with a manual flip is impossible — the second flip is a no-op
   * and returns `false`. We don't broadcast `event.changed` here; the
   * service method handles that per-event.
   */
  private async handlePastStateScan(job: Job): Promise<void> {
    // Compare date-only (drop time). UTC for both sides since
    // `scheduledDate` is `@db.Date` (midnight UTC).
    const today = new Date();
    const todayUtcMidnight = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
    );
    const due = await this.prisma.event.findMany({
      where: {
        state: 'published',
        scheduledDate: { lte: todayUtcMidnight, not: null },
      },
      select: { id: true, scheduledDate: true },
    });
    if (due.length === 0) {
      this.logger.debug(`past-state scan: nothing due (job ${job.id})`);
      return;
    }
    let flipped = 0;
    for (const evt of due) {
      // Inline the state flip + audit + broadcast — we deliberately don't
      // depend on EventsService here to keep the worker dependency surface
      // small (EventsService pulls in MembersService, segment lookups,
      // realtime, etc). The semantics are intentionally identical to
      // `EventsService.markPastSystem`.
      await this.prisma.event.update({
        where: { id: evt.id },
        data: { state: 'past' },
      });
      await this.audit.record({
        action: 'event.marked_past',
        actorUserId: null,
        eventId: evt.id,
        details: {
          scheduledDate: evt.scheduledDate?.toISOString().slice(0, 10) ?? null,
          via: 'worker',
        },
      });
      // Note: no realtime broadcast from the worker. The RealtimeGateway is
      // an HTTP+WS gateway and only boots cleanly inside the API container.
      // Users viewing an event right when the flip happens will see the new
      // state on their next page-level request — fine for an hourly cadence
      // (worst case is a ~1-hour stale tab). Manual `markPast` from the API
      // controller still broadcasts as before.
      flipped++;
    }
    this.logger.log(
      `past-state scan: flipped ${flipped}/${due.length} event(s) (job ${job.id})`,
    );
  }

  private async handleRsvpNudge(job: Job): Promise<void> {
    const { eventId, inviteeId } = job.data as { eventId: string; inviteeId: string };

    const invitee = await this.prisma.eventInvitee.findUnique({
      where: { id: inviteeId },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            state: true,
            scheduledDate: true,
            features: true,
            creator: { select: { name: true, email: true } },
          },
        },
      },
    });

    // Guard rails — many ways for a job to be "stale" by the time it runs.
    if (!invitee) {
      await this.markScheduledReminder(job.id, 'skipped', 'invitee removed');
      return;
    }
    if (invitee.status !== 'pending') {
      await this.markScheduledReminder(job.id, 'skipped', `already ${invitee.status}`);
      return;
    }
    if (invitee.event.state !== 'published') {
      await this.markScheduledReminder(job.id, 'skipped', `event state ${invitee.event.state}`);
      return;
    }
    if (
      !(invitee.event.features as { sharing?: { emailReminders?: boolean } })
        ?.sharing?.emailReminders
    ) {
      await this.markScheduledReminder(job.id, 'skipped', 'tier no longer grants reminders');
      return;
    }

    const rsvpUrl = `${this.webOrigin}/rsvp/${invitee.rsvpToken}`;
    const organizerName =
      invitee.event.creator.name || invitee.event.creator.email;
    const scheduledDateDisplay = invitee.event.scheduledDate
      ? formatDate(invitee.event.scheduledDate)
      : null;

    const { subject, html, text } = renderRsvpNudgeEmail({
      eventTitle: invitee.event.title,
      scheduledDateDisplay,
      organizerName,
      rsvpUrl,
      recipientName: invitee.name,
    });

    try {
      await this.resend.send({ to: invitee.email, subject, html, text });
      await this.markScheduledReminder(job.id, 'sent');
      await this.audit.record({
        action: 'reminder.rsvp_nudge_sent',
        eventId,
        details: { inviteeId, email: invitee.email },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      await this.markScheduledReminder(job.id, 'failed', message);
      throw err; // let BullMQ retry per backoff policy
    }
  }

  private async handleEventTomorrow(job: Job): Promise<void> {
    const { eventId } = job.data as { eventId: string };

    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        title: true,
        state: true,
        scheduledDate: true,
        features: true,
        shareSlug: true,
        creator: { select: { name: true, email: true } },
        invitees: {
          where: { status: { in: ['yes', 'maybe'] } },
          select: { id: true, email: true, name: true, rsvpToken: true, status: true },
        },
      },
    });

    if (!event) {
      await this.markScheduledReminder(job.id, 'skipped', 'event deleted');
      return;
    }
    if (event.state !== 'published') {
      await this.markScheduledReminder(job.id, 'skipped', `event state ${event.state}`);
      return;
    }
    if (
      !(event.features as { sharing?: { emailReminders?: boolean } })?.sharing
        ?.emailReminders
    ) {
      await this.markScheduledReminder(job.id, 'skipped', 'tier no longer grants reminders');
      return;
    }

    const organizerName = event.creator.name || event.creator.email;
    const scheduledDateDisplay = event.scheduledDate
      ? formatDate(event.scheduledDate)
      : null;
    const shareUrl = event.shareSlug ? `${this.webOrigin}/share/${event.shareSlug}` : null;
    const icsUrl = event.shareSlug
      ? `${this.apiOrigin}/api/share/${event.shareSlug}/calendar.ics`
      : null;

    let sent = 0;
    let failed = 0;
    for (const inv of event.invitees) {
      const rsvpUrl = `${this.webOrigin}/rsvp/${inv.rsvpToken}`;
      const { subject, html, text } = renderEventTomorrowEmail({
        eventTitle: event.title,
        scheduledDateDisplay,
        organizerName,
        rsvpUrl,
        shareUrl,
        icsUrl,
        recipientName: inv.name,
        status: inv.status as 'yes' | 'maybe',
      });
      try {
        await this.resend.send({ to: inv.email, subject, html, text });
        sent++;
      } catch (err) {
        failed++;
        this.logger.warn(
          `Tomorrow email failed for ${inv.email} (event ${eventId}): ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }

    await this.markScheduledReminder(
      job.id,
      failed === event.invitees.length && event.invitees.length > 0 ? 'failed' : 'sent',
      `sent=${sent} failed=${failed}`,
    );
    await this.audit.record({
      action: 'reminder.event_tomorrow_sent',
      eventId,
      details: { sent, failed, total: event.invitees.length },
    });
  }

  private async markScheduledReminder(
    bullJobId: string | undefined,
    status: 'sent' | 'failed' | 'skipped',
    note?: string,
  ): Promise<void> {
    if (!bullJobId) return;
    await this.prisma.scheduledReminder
      .updateMany({
        where: { bullJobId, status: 'scheduled' },
        data: {
          status,
          sentAt: status === 'sent' ? new Date() : null,
          error: status === 'failed' ? note ?? null : null,
        },
      })
      .catch((err: unknown) => {
        // Best-effort: if the row was deleted (event archived/cascade) we
        // shouldn't crash the job over bookkeeping.
        this.logger.warn(
          `Could not update ScheduledReminder for ${bullJobId}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      });
  }
}

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat('en-NG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d);
}
