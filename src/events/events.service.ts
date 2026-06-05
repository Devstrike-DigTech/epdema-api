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

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../infra/audit/audit.service';
import { MembersService } from '../members/members.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ResendAdapter } from '../notifications/resend.adapter';
import { renderPublishReadyEmail } from '../notifications/event-publish-ready.template';
import { RemindersService } from '../reminders/reminders.service';
import { CreateEventDraftDto } from './dto/create-event-draft.dto';
import { UpdateEventDraftDto } from './dto/update-event-draft.dto';

/** States the user can still edit. Editing a provisioned event uses different
 *  endpoints (rename, tier upgrade, etc. — Phase 2+). */
const EDITABLE_STATES = new Set(['draft', 'payment_pending']);

/** States the event can be published from. */
const PUBLISHABLE_STATES = new Set(['provisioned', 'planning', 'locked']);

/**
 * Slugs we refuse for custom rename. Includes our top-level paths + common
 * "admin-y" words that would surprise a visitor (someone might assume
 * /share/admin is a system page). Lowercased for direct lookup.
 */
const RESERVED_SLUGS = new Set([
  'api', 'auth', 'admin', 'app', 'dashboard', 'events', 'event',
  'share', 'rsvp', 'invitations', 'invitees', 'members', 'tiers',
  'settings', 'help', 'support', 'about', 'pricing', 'terms', 'privacy',
  'login', 'signin', 'signup', 'logout', 'register', 'reset',
  'static', 'public', 'assets', 'uploads', 'health', 'status',
  'www', 'mail', 'm', 'mobile', 'web', 'cdn',
]);

export type PublishBlockerKind =
  | 'state_not_publishable'
  | 'no_scheduled_date'
  | 'no_segments'
  | 'unlocked_segments'
  | 'odd_voting_count';

export interface PublishBlocker {
  kind: PublishBlockerKind;
  message: string;
  details?: Record<string, unknown>;
}

export interface PublishReadiness {
  ready: boolean;
  blockers: PublishBlocker[];
  /** Counts shown to the UI so the admin can act without a separate fetch. */
  totalSegments: number;
  lockedSegments: number;
  votingMembers: number;
}

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);
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

  async createDraft(userId: string, dto: CreateEventDraftDto) {
    // Wrap creation + planning-member insert + audit in one transaction so the
    // creator can immediately see their own event via `listForUser` (which
    // filters on planning membership). Previously the planningMember row only
    // appeared after payment or invite-accept, leaving a draft invisible to
    // its own creator on the events list.
    return this.prisma.$transaction(async (tx) => {
      const event = await tx.event.create({
        data: {
          creatorId: userId,
          title: dto.title,
          eventType: dto.eventType,
          scheduledDate: dto.scheduledDate ?? null,
          description: dto.description ?? null,
          state: 'draft',
        },
        include: { addons: true },
      });
      // Idempotent — the payment-success path also upserts this; pre-creating
      // here means listForUser works pre-payment too. `invitedById = userId`
      // (self-invite) is the only sensible non-null value for the creator.
      await tx.planningMember.upsert({
        where: {
          eventId_userId: { eventId: event.id, userId },
        },
        create: {
          eventId: event.id,
          userId,
          role: 'admin',
          invitedById: userId,
        },
        update: {},
      });
      await this.audit.record({
        action: 'event.created',
        actorUserId: userId,
        eventId: event.id,
        details: { title: event.title, eventType: event.eventType },
        tx,
      });
      return event;
    });
  }

  /**
   * Lists events the user is a planning member of (incl. their own).
   * Phase 4 broadened this from "events I created" to "events I'm in".
   */
  async listForUser(userId: string) {
    return this.prisma.event.findMany({
      where: {
        archivedAt: null,
        planningMembers: { some: { userId } },
      },
      orderBy: { updatedAt: 'desc' },
      include: { addons: true },
    });
  }

  /**
   * Creator-only access. Used for payment intents, event-detail editing,
   * tier upgrades — actions only the event owner can perform.
   * Returns 404 (not 403) so we don't leak existence to non-creators.
   */
  async getOwnedOrThrow(userId: string, eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { addons: true },
    });
    if (!event) throw new NotFoundException('Event not found');
    if (event.creatorId !== userId) {
      throw new NotFoundException('Event not found');
    }
    return event;
  }

  /**
   * Any-planning-member access. Used for reads + planning-room actions.
   * Pre-provisioning (draft / payment_pending) only the creator can see it
   * since there are no members yet. Returns the event with `currentUserRole`
   * resolved so the UI can show/hide admin controls without an extra fetch.
   */
  async getAccessibleOrThrow(userId: string, eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        addons: true,
        planningMembers: { where: { userId }, select: { role: true } },
      },
    });
    if (!event) throw new NotFoundException('Event not found');

    const isCreator = event.creatorId === userId;
    // role is `String @db.VarChar(16)` in Prisma — narrow to the known union
    // here so the serializer type stays tight downstream.
    const memberRole = event.planningMembers[0]?.role as
      | 'admin'
      | 'contributor'
      | 'observer'
      | undefined;
    if (!memberRole && !isCreator) {
      throw new NotFoundException('Event not found');
    }

    // Defensive fallback for legacy events created before T-081 — back then
    // `createDraft` didn't insert a planningMember row, so a pre-provisioning
    // creator had no membership at all. Events created after T-081 always
    // have the row; this branch should be unreachable for them.
    const currentUserRole: 'admin' | 'contributor' | 'observer' = memberRole ?? 'admin';

    const { planningMembers, ...rest } = event;
    void planningMembers;
    return { ...rest, currentUserRole };
  }

  async updateDraft(userId: string, eventId: string, dto: UpdateEventDraftDto) {
    const event = await this.getOwnedOrThrow(userId, eventId);
    if (!EDITABLE_STATES.has(event.state)) {
      throw new ForbiddenException(
        `Cannot edit event in state '${event.state}'. Use dedicated endpoints for provisioned events.`,
      );
    }
    const updated = await this.prisma.event.update({
      where: { id: eventId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.eventType !== undefined && { eventType: dto.eventType }),
        ...(dto.scheduledDate !== undefined && { scheduledDate: dto.scheduledDate }),
        ...(dto.description !== undefined && { description: dto.description }),
      },
      include: { addons: true },
    });
    // Tell every connected device in this event's room (mobile + web) that
    // the event row changed so their detail screens refetch. Other mutations
    // already do this (publish/unpublish, segments, members, invitees) —
    // updateDraft was a gap surfaced by Phase 5.5·B5's realtime smoke test.
    this.realtime.broadcastEventChanged(eventId);
    return updated;
  }

  // ────────────────────────────────────────────────────────────
  // Publish workflow (Phase 5a)
  // ────────────────────────────────────────────────────────────

  /**
   * Compute publish-readiness without mutating anything.
   * Used by the frontend to render the pre-publish modal: which blockers
   * to show, where to deep-link, and whether to enable the Publish button.
   */
  async checkPublishReadiness(userId: string, eventId: string): Promise<PublishReadiness> {
    await this.members.assertMemberOrThrow(userId, eventId);

    const event = await this.prisma.event.findUniqueOrThrow({
      where: { id: eventId },
      include: {
        segments: { select: { state: true } },
        planningMembers: { select: { role: true } },
      },
    });

    const totalSegments = event.segments.length;
    const lockedSegments = event.segments.filter((s) => s.state === 'locked').length;
    const votingMembers = event.planningMembers.filter((m) => m.role !== 'observer').length;

    const blockers: PublishBlocker[] = [];

    if (!PUBLISHABLE_STATES.has(event.state)) {
      blockers.push({
        kind: 'state_not_publishable',
        message: `Event is ${event.state}; can only publish from provisioned, planning, or locked.`,
        details: { currentState: event.state },
      });
    }
    if (!event.scheduledDate) {
      blockers.push({
        kind: 'no_scheduled_date',
        message: 'Set a date before publishing — calendar exports and reminders need it.',
      });
    }
    if (totalSegments === 0) {
      blockers.push({
        kind: 'no_segments',
        message: 'Add at least one segment before publishing.',
      });
    } else if (lockedSegments < totalSegments) {
      blockers.push({
        kind: 'unlocked_segments',
        message: `${totalSegments - lockedSegments} of ${totalSegments} segments still need to be decided.`,
        details: { totalSegments, lockedSegments },
      });
    }
    if (votingMembers > 0 && votingMembers % 2 !== 0) {
      blockers.push({
        kind: 'odd_voting_count',
        message: `You have ${votingMembers} voting members. Add one more or set someone to Observer so the count is even.`,
        details: { votingMembers },
      });
    }

    return {
      ready: blockers.length === 0,
      blockers,
      totalSegments,
      lockedSegments,
      votingMembers,
    };
  }

  /**
   * Publish the event. Admin only. Validates everything checkPublishReadiness
   * checks, then generates a share slug and flips state to 'published'.
   */
  async publish(userId: string, eventId: string) {
    await this.members.assertAdminOrThrow(userId, eventId);

    const readiness = await this.checkPublishReadiness(userId, eventId);
    if (!readiness.ready) {
      throw new BadRequestException({
        message: 'Event is not ready to publish.',
        blockers: readiness.blockers,
      });
    }

    // Race-safe re-check + slug generation inside a txn.
    const result = await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.event.findUniqueOrThrow({ where: { id: eventId } });
      if (!PUBLISHABLE_STATES.has(fresh.state)) {
        throw new ConflictException(`Event state changed to '${fresh.state}' between check and publish.`);
      }
      if (fresh.shareSlug) {
        // Was published before; reuse the existing slug so old links still work.
        return tx.event.update({
          where: { id: eventId },
          data: { state: 'published', publishedAt: new Date() },
          include: { addons: true },
        });
      }

      // Generate a unique slug. Short, URL-safe, ~6 trillion combos.
      // Retry on the off chance of a collision.
      for (let attempt = 0; attempt < 6; attempt++) {
        const slug = randomBytes(6).toString('base64url'); // ~8 chars
        try {
          return await tx.event.update({
            where: { id: eventId },
            data: {
              state: 'published',
              publishedAt: new Date(),
              shareSlug: slug,
            },
            include: { addons: true },
          });
        } catch (err) {
          // Prisma P2002 = unique constraint violation. Retry.
          if (
            err &&
            typeof err === 'object' &&
            'code' in err &&
            (err as { code?: string }).code === 'P2002'
          ) {
            continue;
          }
          throw err;
        }
      }
      throw new ConflictException('Could not generate a unique share slug after several attempts.');
    });

    await this.audit.record({
      action: 'event.published',
      actorUserId: userId,
      eventId,
      details: { shareSlug: result.shareSlug },
    });
    this.realtime.broadcastEventChanged(eventId);

    // Schedule the day-before reminder if the tier grants reminders + we have
    // a scheduled date in the future. Best-effort: a queue failure shouldn't
    // block the publish itself.
    if (this.reminders.isEnabledFor(result.features) && result.scheduledDate) {
      try {
        await this.reminders.scheduleTomorrowForEvent(eventId, result.scheduledDate);
      } catch (err) {
        this.logger.warn(
          `Failed to schedule tomorrow reminder for ${eventId}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }

    // Return through getAccessibleOrThrow so the response includes
    // `currentUserRole` — frontend's PublishPanel reads it to decide
    // which view to render and whether to show admin actions.
    return this.getAccessibleOrThrow(userId, eventId);
  }

  /**
   * Unpublish — admin can roll back if they catch a mistake. Returns the
   * event to 'planning' state (preserves all locked segments + share slug
   * so re-publishing works with the same URL).
   */
  /**
   * Phase 7·A — admin-only manual flip from `published` → `past`. Required
   * before planning members can submit reviews. Idempotent: re-calling on
   * an already-past event is a no-op (returns the event unchanged).
   *
   * Guards:
   *   - admin role on this event
   *   - state must currently be `published` (or `past` for idempotency)
   *   - scheduledDate must exist + be in the past (no marking future events
   *     as past — that's nonsensical)
   *
   * 7·D will eventually replace the manual call with a worker that flips
   * the state automatically once the date passes; this endpoint stays for
   * admin-override (early review window, late-running events, etc.).
   */
  async markPast(userId: string, eventId: string) {
    await this.members.assertAdminOrThrow(userId, eventId);

    const event = await this.prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    if (event.state === 'past') {
      return this.getAccessibleOrThrow(userId, eventId); // idempotent no-op
    }
    if (event.state !== 'published') {
      throw new BadRequestException(
        `Cannot mark past — event state is '${event.state}'. Only published events can be marked past.`,
      );
    }
    if (!event.scheduledDate) {
      throw new BadRequestException(
        'Cannot mark past — event has no scheduled date.',
      );
    }
    // Compare date-only (drop time). UTC for both sides since `scheduledDate`
    // is `@db.Date` (midnight UTC).
    const todayUtcMidnight = new Date(
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()),
    );
    if (event.scheduledDate.getTime() > todayUtcMidnight.getTime()) {
      throw new BadRequestException(
        `Cannot mark past — scheduled date (${event.scheduledDate.toISOString().slice(0, 10)}) is still in the future.`,
      );
    }

    await this.prisma.event.update({
      where: { id: eventId },
      data: { state: 'past' },
    });

    await this.audit.record({
      action: 'event.marked_past',
      actorUserId: userId,
      eventId,
      details: { scheduledDate: event.scheduledDate.toISOString().slice(0, 10) },
    });
    this.realtime.broadcastEventChanged(eventId);

    return this.getAccessibleOrThrow(userId, eventId);
  }

  /**
   * Phase 7·D — worker-driven counterpart to `markPast`. Same business
   * semantics but no admin check (the scanner runs without an actor) and
   * the audit log records `actorUserId=null` with `details.via='worker'`
   * so the manual + automatic transitions stay distinguishable.
   *
   * Returns true if the state actually flipped (caller logs that count).
   * Returns false on any precondition failure — those are silent so a
   * race with a manual flip doesn't spam the worker logs.
   */
  async markPastSystem(eventId: string): Promise<boolean> {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) return false;
    if (event.state !== 'published') return false;
    if (!event.scheduledDate) return false;

    const todayUtcMidnight = new Date(
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()),
    );
    if (event.scheduledDate.getTime() > todayUtcMidnight.getTime()) return false;

    await this.prisma.event.update({
      where: { id: eventId },
      data: { state: 'past' },
    });
    await this.audit.record({
      action: 'event.marked_past',
      actorUserId: null,
      eventId,
      details: {
        scheduledDate: event.scheduledDate.toISOString().slice(0, 10),
        via: 'worker',
      },
    });
    this.realtime.broadcastEventChanged(eventId);
    return true;
  }

  /**
   * Phase 7·D — discovery helper for the auto-transition scanner. Returns
   * every event id with `state='published' AND scheduledDate <= today`.
   * Cheap to call hourly; an index on (state, scheduledDate) keeps it
   * sub-millisecond even at thousands of events.
   */
  async findDuePastEventIds(): Promise<string[]> {
    const todayUtcMidnight = new Date(
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()),
    );
    const rows = await this.prisma.event.findMany({
      where: {
        state: 'published',
        scheduledDate: { lte: todayUtcMidnight, not: null },
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async unpublish(userId: string, eventId: string, reason: string | undefined) {
    await this.members.assertAdminOrThrow(userId, eventId);

    const event = await this.prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    if (event.state !== 'published') {
      throw new BadRequestException(`Cannot unpublish — event state is '${event.state}'.`);
    }

    await this.prisma.event.update({
      where: { id: eventId },
      data: { state: 'planning', publishedAt: null },
    });

    await this.audit.record({
      action: 'event.unpublished',
      actorUserId: userId,
      eventId,
      details: { reason: reason ?? null },
    });
    this.realtime.broadcastEventChanged(eventId);

    // Roll back any pending reminders — best-effort, never block unpublish.
    try {
      await this.reminders.cancelAllForEvent(eventId);
    } catch (err) {
      this.logger.warn(
        `Failed to cancel reminders for ${eventId}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }

    return this.getAccessibleOrThrow(userId, eventId);
  }

  /**
   * Rename the public share slug. Admin-only, tier-gated (Occasion+ via
   * `sharing.customSlug`). Validates format (delegated to the DTO regex),
   * a reserved-word denylist, and uniqueness. Idempotent: passing the
   * current slug is a no-op.
   */
  async renameShareSlug(userId: string, eventId: string, newSlug: string) {
    await this.members.assertAdminOrThrow(userId, eventId);

    const event = await this.prisma.event.findUniqueOrThrow({
      where: { id: eventId },
      select: { features: true, state: true, shareSlug: true },
    });

    // Must be a published (or previously-published) event — slugs are only
    // generated at publish time, so renaming before that has nothing to rename.
    if (!event.shareSlug) {
      throw new BadRequestException(
        'Publish the event first — there is no share slug to rename yet.',
      );
    }

    const features = (event.features ?? {}) as {
      sharing?: { customSlug?: boolean };
    };
    if (!features.sharing?.customSlug) {
      throw new ForbiddenException(
        'Custom share slugs are an Occasion-tier feature. Upgrade to rename.',
      );
    }

    const normalized = newSlug.trim().toLowerCase();
    if (normalized === event.shareSlug) {
      return this.getAccessibleOrThrow(userId, eventId); // no-op
    }

    if (RESERVED_SLUGS.has(normalized)) {
      throw new ConflictException(
        `"${normalized}" is reserved — pick a different slug.`,
      );
    }

    try {
      await this.prisma.event.update({
        where: { id: eventId },
        data: { shareSlug: normalized },
      });
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code?: string }).code === 'P2002'
      ) {
        throw new ConflictException(
          `"${normalized}" is already taken — pick a different slug.`,
        );
      }
      throw err;
    }

    await this.audit.record({
      action: 'event.share_slug_renamed',
      actorUserId: userId,
      eventId,
      details: { from: event.shareSlug, to: normalized },
    });
    this.realtime.broadcastEventChanged(eventId);

    return this.getAccessibleOrThrow(userId, eventId);
  }

  /**
   * Best-effort notification: if `eventId` is now publish-ready, email all
   * admins. Called from SegmentsService.lockSegment after every successful
   * lock — so the last lock fires the email, while earlier locks no-op.
   *
   * Best-effort: failures are logged and swallowed. We never block the lock
   * itself on email delivery. Phase 8 will add a `publishReadyNotifiedAt`
   * column to dedup; for now we accept that unlock+relock could repeat.
   */
  async notifyPublishReadyIfApplicable(eventId: string): Promise<void> {
    try {
      const event = await this.prisma.event.findUnique({
        where: { id: eventId },
        include: {
          segments: { select: { state: true } },
          planningMembers: {
            where: { role: 'admin' },
            include: { user: { select: { id: true, name: true, email: true } } },
          },
        },
      });
      if (!event) return;

      // Only fire when transitioning into ready territory.
      if (!PUBLISHABLE_STATES.has(event.state)) return;
      if (event.segments.length === 0) return;
      if (event.segments.some((s) => s.state !== 'locked')) return;
      if (!event.scheduledDate) return;

      // Voting-count parity check matches checkPublishReadiness.
      const voting = await this.prisma.planningMember.count({
        where: { eventId, role: { not: 'observer' } },
      });
      if (voting > 0 && voting % 2 !== 0) return;

      const publishUrl = `${this.webOrigin}/events/${eventId}`;
      const recipients = event.planningMembers.map((m) => m.user);

      for (const recipient of recipients) {
        const { subject, html, text } = renderPublishReadyEmail({
          eventTitle: event.title,
          eventType: event.eventType,
          publishUrl,
          recipientName: recipient.name,
        });
        try {
          await this.resend.send({ to: recipient.email, subject, html, text });
        } catch (err) {
          this.logger.warn(
            `Publish-ready email delivery failed for ${recipient.email} (event ${eventId})`,
          );
          void err;
        }
      }

      await this.audit.record({
        action: 'event.publish_ready_notified',
        eventId,
        details: { adminCount: recipients.length },
      });
    } catch (err) {
      this.logger.error(
        `notifyPublishReadyIfApplicable failed for event ${eventId}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
