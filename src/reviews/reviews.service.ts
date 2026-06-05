import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { MembersService } from '../members/members.service';
import { AuditService } from '../infra/audit/audit.service';
import { Prisma } from '@prisma/client';

export interface SubmittedReview {
  id: string;
  eventId: string;
  reviewerId: string;
  revieweeId: string;
  rating: number;
  weight: number;
  comment: string | null;
  createdAt: string;
}

/**
 * Phase 7·E anti-gaming knobs. Sketched as constants so smokes can pin them
 * and we can move them into TierFeatures later without re-wiring callers.
 *
 *  - `MIN_WEIGHT`: floor for the most penalized reviewer. 0.25 means a
 *    brand-new account with one event still counts for a quarter of a
 *    veteran reviewer — enough to register, too little to swing a creator
 *    from 4-star to 5-star with one drive-by review.
 *  - `MAX_TENURE_DAYS`: tenure beyond this is full weight. 30 days is
 *    enough to filter sign-up-just-to-review accounts; too long would
 *    penalize genuine new beta users.
 *  - `MAX_ACTIVITY_EVENTS`: planning-member count beyond this is full
 *    weight. 5 events is "I'm a real EPDEMA user", not just a friend who
 *    got invited once.
 */
const MIN_WEIGHT = 0.25;
const MAX_TENURE_DAYS = 30;
const MAX_ACTIVITY_EVENTS = 5;

/**
 * Phase 7·E. Weighted aggregation per (reviewer_tenure_days, reviewer_event_count).
 *
 *   submit() — validate + insert with computed weight + recompute aggregate
 *   listForEvent() — admin/creator see all; planning members see their own row
 *   listGivenByUser() / listReceivedByUser() — personal history
 */
@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly members: MembersService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Submit a 1-5 review of the event creator. Guards:
   *   1. reviewer is a planning member of this event (any role)
   *   2. event state = 'past'
   *   3. reviewer ≠ reviewee (can't self-review your own event)
   *   4. one-per-(reviewer, event) — enforced by the @@unique([eventId,
   *      reviewerId, revieweeId]) Prisma index
   *
   * In a single transaction: insert the review, then recompute the creator's
   * `ratingAvg` + `ratingCount` from ALL reviews of that user. The recompute
   * pulls every row (not just this event) so it's correct after concurrent
   * inserts across multiple events.
   */
  async submit(args: {
    eventId: string;
    reviewerId: string;
    rating: number;
    comment?: string;
  }): Promise<SubmittedReview> {
    if (!Number.isInteger(args.rating) || args.rating < 1 || args.rating > 5) {
      throw new BadRequestException('Rating must be an integer 1-5.');
    }

    await this.members.assertMemberOrThrow(args.reviewerId, args.eventId);

    const event = await this.prisma.event.findUnique({
      where: { id: args.eventId },
      select: { id: true, creatorId: true, state: true, title: true },
    });
    if (!event) throw new NotFoundException('Event not found.');
    if (event.state !== 'past') {
      throw new ForbiddenException(
        `Reviews open after the event has finished. Current state: '${event.state}'.`,
      );
    }
    if (event.creatorId === args.reviewerId) {
      throw new ForbiddenException("You can't review your own event.");
    }

    // Compute the anti-gaming weight up-front so it's stable for this review
    // forever — recomputing it later (when tenure ticks up) would penalise
    // the creator retroactively if a reviewer's metadata changed. Lock once,
    // honour forever.
    const weight = await this.computeWeight(args.reviewerId);

    // Insert + recompute aggregate atomically. If the unique constraint trips
    // (re-submission), translate Prisma's P2002 into a friendly 409.
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const inserted = await tx.eventReview.create({
          data: {
            eventId: args.eventId,
            reviewerId: args.reviewerId,
            revieweeId: event.creatorId,
            rating: args.rating,
            weight: new Prisma.Decimal(weight),
            comment: args.comment?.trim() || null,
          },
        });
        await this.recomputeAggregate(event.creatorId, tx);
        return inserted;
      });

      await this.audit.record({
        action: 'review.submitted',
        actorUserId: args.reviewerId,
        eventId: args.eventId,
        details: {
          revieweeId: event.creatorId,
          rating: args.rating,
          weight,
          hasComment: !!args.comment?.trim(),
        },
      });

      return this.serialize(created);
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code?: string }).code === 'P2002'
      ) {
        throw new ConflictException(
          "You've already reviewed this event. Reviews are one-shot per event.",
        );
      }
      throw err;
    }
  }

  /**
   * Admin OR creator → all reviews on the event (with reviewer's name +
   * comment). Other planning members → only their own row.
   */
  async listForEvent(eventId: string, viewerId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { creatorId: true },
    });
    if (!event) throw new NotFoundException('Event not found.');

    const viewerMember = await this.members.assertMemberOrThrow(viewerId, eventId);
    const isPrivileged =
      viewerMember.role === 'admin' || viewerId === event.creatorId;

    const rows = await this.prisma.eventReview.findMany({
      where: isPrivileged ? { eventId } : { eventId, reviewerId: viewerId },
      orderBy: { createdAt: 'desc' },
      include: {
        reviewer: { select: { id: true, name: true, image: true } },
      },
    });

    return {
      reviews: rows.map((r) => ({
        ...this.serialize(r),
        // Strip comment from non-privileged views (visibility rule per
        // T-098: aggregate is public, raw comments only the creator sees).
        comment: isPrivileged ? r.comment : null,
        reviewer:
          isPrivileged || r.reviewerId === viewerId
            ? { id: r.reviewer.id, name: r.reviewer.name, image: r.reviewer.image }
            : null,
      })),
      isPrivileged,
    };
  }

  async listGivenByUser(userId: string) {
    const rows = await this.prisma.eventReview.findMany({
      where: { reviewerId: userId },
      orderBy: { createdAt: 'desc' },
      include: { event: { select: { id: true, title: true, scheduledDate: true } } },
    });
    return rows.map((r) => ({
      ...this.serialize(r),
      event: {
        id: r.event.id,
        title: r.event.title,
        scheduledDate: r.event.scheduledDate?.toISOString().slice(0, 10) ?? null,
      },
    }));
  }

  /**
   * Reviews received by a user (typically the creator surface). Comments only
   * surface when the viewer IS the reviewee (matches the visibility rule).
   */
  async listReceivedByUser(userId: string, viewerId: string) {
    const isSelf = userId === viewerId;
    const rows = await this.prisma.eventReview.findMany({
      where: { revieweeId: userId },
      orderBy: { createdAt: 'desc' },
      include: {
        event: { select: { id: true, title: true, scheduledDate: true } },
        reviewer: isSelf
          ? { select: { id: true, name: true, image: true } }
          : false,
      },
    });
    return rows.map((r) => ({
      ...this.serialize(r),
      comment: isSelf ? r.comment : null,
      event: {
        id: r.event.id,
        title: r.event.title,
        scheduledDate: r.event.scheduledDate?.toISOString().slice(0, 10) ?? null,
      },
      reviewer:
        isSelf && 'reviewer' in r && r.reviewer
          ? { id: r.reviewer.id, name: r.reviewer.name, image: r.reviewer.image }
          : null,
    }));
  }

  // ── helpers ──────────────────────────────────────────────────────────

  /**
   * Phase 7·E — compute the review's weight from the reviewer's:
   *   1. tenure  — days since their `user` row was created
   *   2. activity — how many distinct events they've been a planning member of
   *
   * Each factor is a linear ramp from 0.5 → 1.0 over the documented window.
   * Final weight = clamp(MIN_WEIGHT, 1.0, tenureFactor * activityFactor).
   *
   * Worked examples (with MIN_WEIGHT=0.25, MAX_TENURE_DAYS=30, MAX_ACTIVITY_EVENTS=5):
   *
   *   - Day-old account, 1 event   → 0.50 * 0.50 = 0.25  (the floor)
   *   - Day-old account, 5 events  → 0.50 * 1.00 = 0.50
   *   - 30-day account, 1 event    → 1.00 * 0.50 = 0.50
   *   - 30-day account, 5+ events  → 1.00 * 1.00 = 1.00  (full weight)
   *   - 15-day account, 3 events   → 0.75 * 0.75 = 0.56
   *
   * The count INCLUDES the current event (this reviewer is a member of it).
   * That keeps the math monotonic — a member's first review is at least 0.25,
   * not zero.
   */
  private async computeWeight(reviewerId: string): Promise<number> {
    const [user, activeEvents] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: reviewerId },
        select: { createdAt: true },
      }),
      this.prisma.planningMember.count({
        where: { userId: reviewerId },
      }),
    ]);

    // No user → should be impossible (we just asserted membership), but
    // fall back to the floor rather than crashing the submission.
    if (!user) return MIN_WEIGHT;

    const ageMs = Date.now() - user.createdAt.getTime();
    const ageDays = Math.max(0, ageMs / (24 * 60 * 60 * 1000));
    // Linear ramp from 0.5 (day 0) to 1.0 (MAX_TENURE_DAYS+).
    const tenureFactor =
      0.5 + 0.5 * Math.min(1, ageDays / MAX_TENURE_DAYS);
    // Linear ramp from 0.5 (1 event) to 1.0 (MAX_ACTIVITY_EVENTS+).
    // Subtract 1 so a single-event member starts at the 0.5 floor of the
    // ramp, not at the slope's intercept.
    const activityFactor =
      0.5 + 0.5 * Math.min(1, Math.max(0, activeEvents - 1) / (MAX_ACTIVITY_EVENTS - 1));

    const raw = tenureFactor * activityFactor;
    // Clamp + round to 2 decimal places (matches Decimal(3,2) column).
    return Math.max(MIN_WEIGHT, Math.min(1.0, Math.round(raw * 100) / 100));
  }

  /**
   * Phase 7·E — recompute `user_profile.ratingAvg` + `ratingCount` from
   * scratch over all reviews of `userId`. Switched from a plain unweighted
   * average to `sum(rating * weight) / sum(weight)` so a flood of
   * low-tenure 5-star reviews can no longer drown a single full-weight 3.
   *
   * `ratingCount` stays as the raw count (not weighted) — users still want
   * to see "12 reviews" even if some of them counted less. The weighting
   * is invisible in the UI but visible in the aggregate.
   *
   * Edge case: zero reviews → ratingAvg=null, ratingCount=0 (e.g. after a
   * review is deleted by future GDPR tooling).
   *
   * Upsert because the user_profile row may not exist yet — Better Auth
   * creates the user without one, and the existing UsersService.upsert is
   * the lazy-create path.
   */
  private async recomputeAggregate(
    userId: string,
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
  ): Promise<void> {
    // Pull every row's (rating, weight) — N rows per user, N small. Doing
    // the math in JS rather than SQL keeps the Decimal arithmetic explicit
    // and side-steps Prisma not surfacing weighted aggregates as a primitive.
    const rows = await tx.eventReview.findMany({
      where: { revieweeId: userId },
      select: { rating: true, weight: true },
    });

    if (rows.length === 0) {
      await tx.userProfile.upsert({
        where: { userId },
        create: { userId, ratingAvg: null, ratingCount: 0 },
        update: { ratingAvg: null, ratingCount: 0 },
      });
      return;
    }

    let numerator = new Prisma.Decimal(0);
    let denominator = new Prisma.Decimal(0);
    for (const r of rows) {
      const w = r.weight; // Decimal
      numerator = numerator.plus(w.times(r.rating));
      denominator = denominator.plus(w);
    }
    // Guard against an all-zero-weight edge case (shouldn't happen with
    // MIN_WEIGHT=0.25, but defensive). Fall back to unweighted mean.
    const avg = denominator.isZero()
      ? new Prisma.Decimal(rows.reduce((a, r) => a + r.rating, 0) / rows.length)
      : numerator.dividedBy(denominator);

    await tx.userProfile.upsert({
      where: { userId },
      create: { userId, ratingAvg: avg, ratingCount: rows.length },
      update: { ratingAvg: avg, ratingCount: rows.length },
    });
  }

  private serialize(r: {
    id: string;
    eventId: string;
    reviewerId: string;
    revieweeId: string;
    rating: number;
    weight: Prisma.Decimal;
    comment: string | null;
    createdAt: Date;
  }): SubmittedReview {
    return {
      id: r.id,
      eventId: r.eventId,
      reviewerId: r.reviewerId,
      revieweeId: r.revieweeId,
      rating: r.rating,
      weight: Number(r.weight),
      comment: r.comment,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
