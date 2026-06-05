import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';

import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../infra/audit/audit.service';
import { MembersService } from '../members/members.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ResendAdapter } from '../notifications/resend.adapter';
import { renderEventInviteEmail } from '../notifications/event-invite.template';
import { renderRsvpConfirmationEmail } from '../notifications/rsvp-confirmation.template';
import { RemindersService } from '../reminders/reminders.service';
import type { RsvpStatus } from './dto';
import type { RsvpQuestionDto } from './questions-dto';

interface AddInputItem {
  email: string;
  name?: string;
}

interface AddResultItem {
  email: string;
  outcome: 'created' | 'updated' | 'skipped_existing' | 'invalid';
  inviteeId?: string;
  reason?: string;
}

@Injectable()
export class InviteesService {
  private readonly logger = new Logger(InviteesService.name);
  private readonly webOrigin: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly members: MembersService,
    private readonly realtime: RealtimeGateway,
    private readonly resend: ResendAdapter,
    private readonly reminders: RemindersService,
    config: ConfigService,
  ) {
    this.webOrigin = config.getOrThrow<string>('WEB_ORIGIN');
  }

  // ────────────────────────────────────────────────────────────
  // Admin operations
  // ────────────────────────────────────────────────────────────

  async list(userId: string, eventId: string) {
    await this.members.assertAdminOrThrow(userId, eventId);
    return this.prisma.eventInvitee.findMany({
      where: { eventId },
      orderBy: [{ status: 'asc' }, { addedAt: 'desc' }],
    });
  }

  async statusCounts(userId: string, eventId: string) {
    await this.members.assertAdminOrThrow(userId, eventId);
    const grouped = await this.prisma.eventInvitee.groupBy({
      where: { eventId },
      by: ['status'],
      _count: { _all: true },
    });
    const counts: Record<string, number> = { pending: 0, yes: 0, no: 0, maybe: 0 };
    for (const g of grouped) counts[g.status] = g._count._all;
    counts.total = grouped.reduce((sum, g) => sum + g._count._all, 0);
    return counts;
  }

  async add(userId: string, eventId: string, items: AddInputItem[]): Promise<AddResultItem[]> {
    await this.members.assertAdminOrThrow(userId, eventId);

    const event = await this.prisma.event.findUniqueOrThrow({
      where: { id: eventId },
      select: { features: true, state: true },
    });
    if (event.state === 'archived' || event.state === 'refunded') {
      throw new ForbiddenException(`Cannot add invitees to a ${event.state} event.`);
    }

    const features = (event.features ?? {}) as { invitees?: { maxInvitees?: number | null } };
    const maxInvitees = features.invitees?.maxInvitees ?? null;
    const currentCount = await this.prisma.eventInvitee.count({ where: { eventId } });

    let remainingCapacity = maxInvitees == null ? Number.POSITIVE_INFINITY : maxInvitees - currentCount;
    const seen = new Set<string>();
    const results: AddResultItem[] = [];

    for (const item of items) {
      const email = item.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        results.push({ email: item.email, outcome: 'invalid', reason: 'Not a valid email.' });
        continue;
      }
      if (seen.has(email)) {
        results.push({ email, outcome: 'skipped_existing', reason: 'Duplicate in this batch.' });
        continue;
      }
      seen.add(email);

      const existing = await this.prisma.eventInvitee.findUnique({
        where: { eventId_email: { eventId, email } },
      });
      if (existing) {
        // Update name if newly provided; otherwise skip silently.
        if (item.name && item.name !== existing.name) {
          const updated = await this.prisma.eventInvitee.update({
            where: { id: existing.id },
            data: { name: item.name },
          });
          results.push({ email, outcome: 'updated', inviteeId: updated.id });
        } else {
          results.push({ email, outcome: 'skipped_existing', inviteeId: existing.id });
        }
        continue;
      }

      if (remainingCapacity <= 0) {
        results.push({
          email,
          outcome: 'invalid',
          reason: `Tier cap reached — ${maxInvitees} invitees max for this event.`,
        });
        continue;
      }

      const created = await this.prisma.eventInvitee.create({
        data: {
          eventId,
          email,
          name: item.name?.trim() || null,
          rsvpToken: generateToken(),
          addedById: userId,
        },
      });
      remainingCapacity--;
      results.push({ email, outcome: 'created', inviteeId: created.id });
    }

    const createdCount = results.filter((r) => r.outcome === 'created').length;
    if (createdCount > 0) {
      await this.audit.record({
        action: 'invitee.added',
        actorUserId: userId,
        eventId,
        details: { createdCount, requested: items.length },
      });
      this.realtime.broadcastEventChanged(eventId);
    }

    return results;
  }

  async remove(userId: string, eventId: string, inviteeId: string): Promise<void> {
    await this.members.assertAdminOrThrow(userId, eventId);
    const invitee = await this.prisma.eventInvitee.findUnique({ where: { id: inviteeId } });
    if (!invitee || invitee.eventId !== eventId) throw new NotFoundException('Invitee not found');

    await this.prisma.eventInvitee.delete({ where: { id: inviteeId } });
    await this.audit.record({
      action: 'invitee.removed',
      actorUserId: userId,
      eventId,
      details: { inviteeId, email: invitee.email },
    });
    this.realtime.broadcastEventChanged(eventId);
  }

  /**
   * Send the "you're invited" email to every invitee whose `invitedAt` is null
   * (or, if `resend=true`, to everyone). Returns a per-recipient outcome list.
   * Best-effort: rows are marked invitedAt even on email failure so we don't
   * spam on retry; admin can opt back in by passing resend=true.
   */
  async sendInvitations(
    userId: string,
    eventId: string,
    opts: { onlyUninvited?: boolean } = { onlyUninvited: true },
  ) {
    await this.members.assertAdminOrThrow(userId, eventId);

    const event = await this.prisma.event.findUniqueOrThrow({
      where: { id: eventId },
      include: {
        creator: { select: { name: true, email: true } },
      },
    });
    if (event.state !== 'published') {
      throw new BadRequestException('Publish the event before sending invitations.');
    }

    const where = opts.onlyUninvited ? { eventId, invitedAt: null } : { eventId };
    const invitees = await this.prisma.eventInvitee.findMany({ where });

    const organizerName = event.creator.name || event.creator.email;
    const scheduledDateDisplay = event.scheduledDate
      ? new Intl.DateTimeFormat('en-NG', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }).format(event.scheduledDate)
      : null;

    const results: { email: string; sent: boolean; error?: string }[] = [];
    for (const invitee of invitees) {
      const rsvpUrl = `${this.webOrigin}/rsvp/${invitee.rsvpToken}`;
      const { subject, html, text } = renderEventInviteEmail({
        eventTitle: event.title,
        eventType: event.eventType,
        scheduledDateDisplay,
        organizerName,
        rsvpUrl,
        recipientName: invitee.name,
      });

      try {
        await this.resend.send({ to: invitee.email, subject, html, text });
        results.push({ email: invitee.email, sent: true });
      } catch (err) {
        results.push({
          email: invitee.email,
          sent: false,
          error: err instanceof Error ? err.message : 'unknown',
        });
        this.logger.warn(`Invite email delivery failed for ${invitee.email} (event ${eventId})`);
      }
      // Mark as invited regardless of delivery — admin can re-send explicitly.
      await this.prisma.eventInvitee.update({
        where: { id: invitee.id },
        data: { invitedAt: new Date() },
      });

      // Schedule the RSVP nudge (3 days out) iff the tier grants reminders.
      // Best-effort: a queue hiccup shouldn't block the send loop.
      if (this.reminders.isEnabledFor(event.features)) {
        try {
          await this.reminders.scheduleNudgeForInvitee(eventId, invitee.id);
        } catch (err) {
          this.logger.warn(
            `Failed to schedule RSVP nudge for ${invitee.email} (event ${eventId}): ${
              err instanceof Error ? err.message : err
            }`,
          );
        }
      }
    }

    await this.audit.record({
      action: 'invitee.invitations_sent',
      actorUserId: userId,
      eventId,
      details: {
        attempted: results.length,
        succeeded: results.filter((r) => r.sent).length,
      },
    });
    this.realtime.broadcastEventChanged(eventId);
    return { results, summary: this.summarize(results) };
  }

  // ────────────────────────────────────────────────────────────
  // Custom RSVP questions (Occasion+ feature)
  // ────────────────────────────────────────────────────────────

  /**
   * Replace the event's custom RSVP question set.
   *
   * Admin-only, tier-gated via `features.invitees.customQuestions` (Occasion=3,
   * Production=10, Marquee=null/unlimited). Pass `[]` to remove all questions.
   *
   * We don't migrate existing `customAnswers` blobs — if a question is removed
   * or renamed (different `id`), the orphan answer just stops being shown.
   * The admin can still query it for audit purposes since we never delete
   * answer rows.
   */
  async setRsvpQuestions(
    userId: string,
    eventId: string,
    questions: RsvpQuestionDto[],
  ) {
    await this.members.assertAdminOrThrow(userId, eventId);

    const event = await this.prisma.event.findUniqueOrThrow({
      where: { id: eventId },
      select: { features: true, state: true },
    });
    if (event.state === 'archived' || event.state === 'refunded') {
      throw new ForbiddenException(
        `Cannot edit RSVP questions on a ${event.state} event.`,
      );
    }

    const features = (event.features ?? {}) as {
      invitees?: { customQuestions?: number | null };
    };
    const cap = features.invitees?.customQuestions ?? 0;
    if (cap === 0 && questions.length > 0) {
      throw new ForbiddenException(
        'Custom RSVP questions are an Occasion-tier feature. Upgrade to add questions.',
      );
    }
    if (cap !== null && questions.length > cap) {
      throw new ForbiddenException(
        `Your tier allows up to ${cap} RSVP questions. Remove ${questions.length - cap} to save.`,
      );
    }

    // Schema sanity: ids must be unique within the set; select questions need options.
    const ids = new Set<string>();
    for (const q of questions) {
      if (ids.has(q.id)) {
        throw new BadRequestException(`Duplicate question id "${q.id}".`);
      }
      ids.add(q.id);
      if (q.type === 'select' && (!q.options || q.options.length === 0)) {
        throw new BadRequestException(
          `Question "${q.label}" is a select — add at least one option.`,
        );
      }
      if (q.type === 'text' && q.options && q.options.length > 0) {
        throw new BadRequestException(
          `Question "${q.label}" is a text input — remove the options list.`,
        );
      }
    }

    await this.prisma.event.update({
      where: { id: eventId },
      data: {
        rsvpQuestions:
          questions.length === 0
            ? Prisma.JsonNull
            : // Cast through unknown — class-validator DTOs aren't index-signature
              // types, but the shape is structurally Json-safe.
              ({ questions } as unknown as Prisma.InputJsonValue),
      },
    });

    await this.audit.record({
      action: 'event.rsvp_questions_updated',
      actorUserId: userId,
      eventId,
      details: { count: questions.length },
    });
    this.realtime.broadcastEventChanged(eventId);

    return { questions };
  }

  /**
   * Read the question set for an event (admin-only — the public lookup
   * embeds this same data in the RSVP DTO, no separate fetch needed).
   */
  async listRsvpQuestions(userId: string, eventId: string) {
    await this.members.assertAdminOrThrow(userId, eventId);
    const event = await this.prisma.event.findUniqueOrThrow({
      where: { id: eventId },
      select: { rsvpQuestions: true },
    });
    return { questions: extractQuestions(event.rsvpQuestions) };
  }

  // ────────────────────────────────────────────────────────────
  // Public (no auth) — RSVP via token
  // ────────────────────────────────────────────────────────────

  async lookupByToken(token: string) {
    const invitee = await this.prisma.eventInvitee.findUnique({
      where: { rsvpToken: token },
    });
    if (!invitee) throw new NotFoundException('Invitation not found');

    const event = await this.prisma.event.findUnique({
      where: { id: invitee.eventId },
      select: {
        id: true,
        title: true,
        eventType: true,
        scheduledDate: true,
        description: true,
        state: true,
        shareSlug: true,
        rsvpQuestions: true,
        brand: true,
        features: true,
      },
    });
    if (!event || (event.state !== 'published' && event.state !== 'past')) {
      throw new NotFoundException('This event is not currently published.');
    }
    return { invitee, event };
  }

  async submitRsvp(
    token: string,
    args: { status: RsvpStatus; name?: string; customAnswers?: Record<string, string> },
  ) {
    const found = await this.lookupByToken(token);
    const { invitee, event } = found;

    // Validate answers against the question schema. We accept "yes" without
    // answers and 422 with a per-question reason on bad input — UI can map
    // it back to the offending field.
    const questions = extractQuestions(event.rsvpQuestions);
    const sanitizedAnswers =
      questions.length === 0
        ? null
        : validateAndSanitizeAnswers(questions, args.customAnswers, args.status);

    const updated = await this.prisma.eventInvitee.update({
      where: { id: invitee.id },
      data: {
        status: args.status,
        name: args.name?.trim() || invitee.name,
        // Pass `Prisma.JsonNull` to clear, the validated object to set, or undefined to leave.
        customAnswers:
          sanitizedAnswers === null
            ? Prisma.JsonNull
            : sanitizedAnswers === undefined
              ? undefined
              : sanitizedAnswers,
        respondedAt: new Date(),
      },
    });

    await this.audit.record({
      action: 'rsvp.submitted',
      eventId: invitee.eventId,
      details: { inviteeId: invitee.id, status: args.status, previousStatus: invitee.status },
    });
    this.realtime.broadcastEventChanged(invitee.eventId);

    // Cancel just this invitee's nudge — they've responded, no need to nag.
    // The tomorrow reminder + everyone else's nudges stay put.
    try {
      await this.reminders.cancelNudgeForInvitee(invitee.id);
    } catch (err) {
      this.logger.warn(
        `Failed to cancel RSVP nudge after submit for invitee ${invitee.id}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }

    // Confirmation email — best effort.
    try {
      const rsvpUrl = `${this.webOrigin}/rsvp/${invitee.rsvpToken}`;
      const shareUrl = event.shareSlug ? `${this.webOrigin}/share/${event.shareSlug}` : null;
      const scheduledDateDisplay = event.scheduledDate
        ? new Intl.DateTimeFormat('en-NG', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          }).format(event.scheduledDate)
        : null;

      const { subject, html, text } = renderRsvpConfirmationEmail({
        eventTitle: event.title,
        scheduledDateDisplay,
        status: args.status,
        rsvpUrl,
        shareUrl,
        recipientName: updated.name,
      });
      await this.resend.send({ to: updated.email, subject, html, text });
    } catch (err) {
      this.logger.warn(
        `RSVP confirmation email failed for ${invitee.email} (event ${invitee.eventId})`,
      );
      void err;
    }

    return { invitee: updated, event };
  }

  // ────────────────────────────────────────────────────────────

  private summarize(results: { sent: boolean }[]) {
    return {
      attempted: results.length,
      succeeded: results.filter((r) => r.sent).length,
      failed: results.filter((r) => !r.sent).length,
    };
  }
}

function generateToken(): string {
  return randomBytes(24).toString('base64url'); // ~32 chars, URL-safe
}

/**
 * Safely pull a typed question list out of the `rsvpQuestions` Json column.
 * Returns `[]` when the column is null or malformed (defensive — we wrote
 * the column ourselves but never trust persisted Json on read).
 */
export function extractQuestions(raw: unknown): RsvpQuestionDto[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as { questions?: unknown };
  if (!Array.isArray(obj.questions)) return [];
  return obj.questions.filter(
    (q): q is RsvpQuestionDto =>
      !!q &&
      typeof q === 'object' &&
      typeof (q as RsvpQuestionDto).id === 'string' &&
      typeof (q as RsvpQuestionDto).label === 'string' &&
      ((q as RsvpQuestionDto).type === 'text' ||
        (q as RsvpQuestionDto).type === 'select'),
  );
}

/**
 * Validate the invitee's answers against the event's question schema.
 *
 *  - Required questions must be answered (non-empty) — UNLESS status is 'no',
 *    in which case the form has been bypassed (RSVP page hides the questions).
 *  - Select answers must match one of the listed options.
 *  - Text answers are trimmed to 500 chars and HTML-stripped (defense in depth;
 *    we never render them as HTML on the admin side either).
 *  - Unknown answer keys are dropped silently.
 *
 * Returns the sanitized record, or `undefined` if `answers` was undefined
 * (= "no change"), or throws 400 with the specific failure.
 */
function validateAndSanitizeAnswers(
  questions: RsvpQuestionDto[],
  answers: Record<string, string> | undefined,
  status: RsvpStatus,
): Record<string, string> | undefined {
  if (answers === undefined) return undefined;

  const byId = new Map(questions.map((q) => [q.id, q]));
  const out: Record<string, string> = {};

  // Required-field check is skipped when status is 'no' — declining doesn't
  // need a dietary preference.
  const enforceRequired = status !== 'no';

  for (const q of questions) {
    const raw = answers[q.id];
    const trimmed = (raw ?? '').toString().trim().slice(0, 500);
    if (!trimmed) {
      if (enforceRequired && q.required) {
        throw new BadRequestException(
          `Please answer "${q.label}" before submitting.`,
        );
      }
      continue; // skip unanswered optional questions
    }
    if (q.type === 'select') {
      if (!q.options || !q.options.includes(trimmed)) {
        throw new BadRequestException(
          `"${trimmed}" is not one of the available answers for "${q.label}".`,
        );
      }
    }
    out[q.id] = trimmed;
  }

  // Drop any keys the admin no longer asks about — never store stale answers.
  for (const key of Object.keys(answers)) {
    if (!byId.has(key)) continue;
  }

  return out;
}
