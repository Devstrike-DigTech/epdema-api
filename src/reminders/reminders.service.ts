import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../infra/queue/queue.service';
import { JOB_NAMES, jobIdFor } from '../infra/queue/queue.constants';

/**
 * RSVP nudge fires this many ms after `invitedAt`. 3 days in production;
 * NUDGE_DELAY_OVERRIDE_MS in the env knocks it down for smoke tests.
 */
const DEFAULT_NUDGE_DELAY_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Day-before reminder fires this many ms BEFORE `event.scheduledDate`.
 * 24h in production; TOMORROW_OFFSET_OVERRIDE_MS shortcuts it.
 */
const DEFAULT_TOMORROW_OFFSET_MS = 24 * 60 * 60 * 1000;

interface NudgeJobPayload {
  eventId: string;
  inviteeId: string;
}

interface TomorrowJobPayload {
  eventId: string;
}

/**
 * Producer-side reminders API. Enqueues BullMQ jobs and mirrors them into the
 * `scheduled_reminder` table so admins can see what's pending without
 * round-tripping to Redis. The actual sends live in ReminderProcessor.
 *
 * Tier gate: feature `sharing.emailReminders` (Gathering+). Caller is expected
 * to check this — we don't no-op silently here because that would mask bugs.
 */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);
  private readonly nudgeDelayMs: number;
  private readonly tomorrowOffsetMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    config: ConfigService,
  ) {
    this.nudgeDelayMs =
      Number(config.get('NUDGE_DELAY_OVERRIDE_MS')) || DEFAULT_NUDGE_DELAY_MS;
    this.tomorrowOffsetMs =
      Number(config.get('TOMORROW_OFFSET_OVERRIDE_MS')) || DEFAULT_TOMORROW_OFFSET_MS;
  }

  /**
   * Returns whether the event's tier grants email reminders.
   * Callers should bail early when this is false — no row inserts, no jobs.
   */
  isEnabledFor(features: unknown): boolean {
    const f = (features ?? {}) as { sharing?: { emailReminders?: boolean } };
    return f.sharing?.emailReminders === true;
  }

  /**
   * Schedule the RSVP nudge for a single invitee. Called from
   * InviteesService.sendInvitations right after the invite email goes out.
   * Idempotent — passing the same inviteeId twice replaces the prior job
   * (BullMQ jobId is a composite of kind + invitee).
   */
  async scheduleNudgeForInvitee(
    eventId: string,
    inviteeId: string,
  ): Promise<void> {
    const runAt = new Date(Date.now() + this.nudgeDelayMs);
    const bullJobId = jobIdFor.rsvpNudge(inviteeId);
    const payload: NudgeJobPayload = { eventId, inviteeId };

    // Cancel any prior nudge for this invitee (e.g. on re-invite).
    await this.cancelByBullJobId(bullJobId);

    await this.queue.queue.add(JOB_NAMES.rsvpNudge, payload, {
      jobId: bullJobId,
      delay: this.nudgeDelayMs,
      removeOnComplete: { age: 7 * 24 * 60 * 60 }, // keep 7d for debugging
      removeOnFail: { age: 30 * 24 * 60 * 60 },
      attempts: 3,
      backoff: { type: 'exponential', delay: 60_000 }, // 1m → 2m → 4m
    });

    await this.prisma.scheduledReminder.create({
      data: {
        eventId,
        inviteeId,
        kind: 'rsvp_nudge',
        runAt,
        bullJobId,
        payload: payload as unknown as object,
      },
    });
  }

  /**
   * Schedule the day-before reminder for an event. Idempotent. Caller should
   * have already verified `event.scheduledDate != null` and the event is
   * published.
   */
  async scheduleTomorrowForEvent(eventId: string, scheduledDate: Date): Promise<void> {
    const runAt = new Date(scheduledDate.getTime() - this.tomorrowOffsetMs);
    if (runAt.getTime() <= Date.now()) {
      this.logger.warn(
        `Skipping tomorrow reminder for ${eventId}: scheduledDate is too close.`,
      );
      return;
    }
    const bullJobId = jobIdFor.eventTomorrow(eventId);
    const payload: TomorrowJobPayload = { eventId };

    await this.cancelByBullJobId(bullJobId);

    await this.queue.queue.add(JOB_NAMES.eventTomorrow, payload, {
      jobId: bullJobId,
      delay: runAt.getTime() - Date.now(),
      removeOnComplete: { age: 7 * 24 * 60 * 60 },
      removeOnFail: { age: 30 * 24 * 60 * 60 },
      attempts: 3,
      backoff: { type: 'exponential', delay: 60_000 },
    });

    await this.prisma.scheduledReminder.create({
      data: {
        eventId,
        kind: 'event_tomorrow',
        runAt,
        bullJobId,
        payload: payload as unknown as object,
      },
    });
  }

  /**
   * Cancel just the RSVP nudge for one invitee. Called from submitRsvp
   * (they've responded, so a nudge would be silly). Tomorrow reminder
   * stays in place for everyone else.
   */
  async cancelNudgeForInvitee(inviteeId: string): Promise<void> {
    const bullJobId = jobIdFor.rsvpNudge(inviteeId);
    await this.cancelByBullJobId(bullJobId);
  }

  /**
   * Cancel every still-pending reminder for an event. Called from
   * EventsService.unpublish and exposed via the admin API.
   *
   * We mark rows as 'cancelled' rather than deleting so admins can still see
   * the history of what was promised.
   */
  async cancelAllForEvent(eventId: string): Promise<{ cancelled: number }> {
    const rows = await this.prisma.scheduledReminder.findMany({
      where: { eventId, status: 'scheduled' },
      select: { id: true, bullJobId: true },
    });
    for (const r of rows) {
      if (r.bullJobId) {
        await this.queue.queue.remove(r.bullJobId).catch(() => undefined);
      }
    }
    await this.prisma.scheduledReminder.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { status: 'cancelled' },
    });
    return { cancelled: rows.length };
  }

  /**
   * List reminders for an admin UI. Returns scheduled + recent history so the
   * admin can confirm "yes the worker is sending stuff".
   */
  async listForEvent(eventId: string) {
    return this.prisma.scheduledReminder.findMany({
      where: { eventId },
      orderBy: [{ status: 'asc' }, { runAt: 'asc' }],
      take: 200,
    });
  }

  private async cancelByBullJobId(bullJobId: string): Promise<void> {
    await this.queue.queue.remove(bullJobId).catch(() => undefined);
    await this.prisma.scheduledReminder.updateMany({
      where: { bullJobId, status: 'scheduled' },
      data: { status: 'cancelled' },
    });
  }
}
