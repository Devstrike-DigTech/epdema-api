import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../infra/audit/audit.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { EventsService } from '../events/events.service';
import { MembersService } from '../members/members.service';
import { defaultSegmentsFor } from './default-segments';
import type { EventType } from '../events/dto/create-event-draft.dto';

interface FeaturesShape {
  event?: { maxSegments?: number | null };
}

/**
 * Embed shape returned by `getDetail` — segment + live proposals + each
 * proposal's live objections. One DB round-trip; renders the entire
 * segment-detail page in the web app.
 */
const SEGMENT_DETAIL_INCLUDE = {
  proposals: {
    where: { state: { in: ['live', 'winner'] } },
    orderBy: { createdAt: 'asc' as const },
    include: {
      proposedBy: { select: { id: true, name: true, email: true } },
      objections: {
        where: { state: 'live' },
        orderBy: { createdAt: 'asc' as const },
        include: {
          raisedBy: { select: { id: true, name: true, email: true } },
        },
      },
    },
  },
} satisfies Prisma.SegmentInclude;

export type SegmentWithDetail = Prisma.SegmentGetPayload<{ include: typeof SEGMENT_DETAIL_INCLUDE }>;

@Injectable()
export class SegmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
    private readonly members: MembersService,
  ) {}

  /**
   * Auto-create the default segment set for a newly-provisioned event.
   * Called from PaymentsService.provisionEvent inside the same transaction
   * so the event + its segments arrive atomically.
   *
   * Idempotent: if segments already exist for this event, this is a no-op.
   */
  async createDefaultsForEvent(
    tx: Prisma.TransactionClient,
    args: {
      eventId: string;
      eventType: string;
      features: unknown;
    },
  ): Promise<void> {
    const existing = await tx.segment.count({ where: { eventId: args.eventId } });
    if (existing > 0) return;

    const features = (args.features ?? {}) as FeaturesShape;
    const maxSegments = features.event?.maxSegments ?? null;

    const templates = defaultSegmentsFor(args.eventType as EventType, maxSegments);

    // Bulk insert in order. Position is the array index so the UI renders
    // them in the priority order from default-segments.ts.
    await tx.segment.createMany({
      data: templates.map((t, idx) => ({
        eventId: args.eventId,
        segmentType: t.segmentType,
        title: t.title,
        description: t.description,
        position: idx,
        state: 'open',
      })),
    });
  }

  // ────────────────────────────────────────────────────────────
  // Reads
  // ────────────────────────────────────────────────────────────

  /** Any planning member can list segments. */
  async listForEvent(userId: string, eventId: string) {
    await this.members.assertMemberOrThrow(userId, eventId);
    return this.prisma.segment.findMany({
      where: { eventId },
      orderBy: { position: 'asc' },
    });
  }

  /** Any planning member can get segment detail. */
  async getDetail(userId: string, eventId: string, segmentId: string): Promise<SegmentWithDetail> {
    await this.members.assertMemberOrThrow(userId, eventId);
    const segment = await this.prisma.segment.findFirst({
      where: { id: segmentId, eventId },
      include: SEGMENT_DETAIL_INCLUDE,
    });
    if (!segment) throw new NotFoundException('Segment not found');
    return segment;
  }

  /**
   * Any planning member can read. Returns the segment with its event for
   * downstream use. NOT the same as "can mutate" — see assertMutableOrThrow.
   */
  async assertReadableOrThrow(userId: string, segmentId: string) {
    const segment = await this.prisma.segment.findUnique({
      where: { id: segmentId },
      include: { event: { select: { id: true, creatorId: true } } },
    });
    if (!segment) throw new NotFoundException('Segment not found');
    await this.members.assertMemberOrThrow(userId, segment.event.id);
    return segment;
  }

  /**
   * Like `assertReadableOrThrow` but also enforces that the segment is in a
   * state that can still be edited. Throws Forbidden on locked.
   *
   * Phase 3b allows mutation while state ∈ {open, proposed, objected}.
   * Phase 3c will tighten this once convergence + lock land.
   */
  async assertMutableOrThrow(userId: string, segmentId: string) {
    const segment = await this.assertReadableOrThrow(userId, segmentId);
    if (segment.state === 'locked') {
      throw new ForbiddenException('Segment is locked; unlock before further changes.');
    }
    return segment;
  }

  // ────────────────────────────────────────────────────────────
  // State machine — Phase 3b transitions
  // ────────────────────────────────────────────────────────────

  /**
   * Recompute the segment's `state` based on its current proposals + objections.
   * Runs inside the caller's transaction so the segment + child mutation are
   * atomic. Returns the new state.
   *
   * Phase 3b rules (deliberately loose — 3c tightens with convergence/lock):
   *   • 0 live proposals                                     → 'open'
   *   • ≥1 live proposals, 0 live objections on any of them  → 'proposed'
   *   • ≥1 live proposals, ≥1 live objection on any of them  → 'objected'
   *
   * Never overwrites a 'locked' segment.
   */
  async recomputeState(tx: Prisma.TransactionClient, segmentId: string): Promise<string> {
    const seg = await tx.segment.findUniqueOrThrow({ where: { id: segmentId } });
    if (seg.state === 'locked') return seg.state;

    const liveProposalIds = (
      await tx.proposal.findMany({
        where: { segmentId, state: 'live' },
        select: { id: true },
      })
    ).map((p) => p.id);

    let nextState: string;
    if (liveProposalIds.length === 0) {
      nextState = 'open';
    } else {
      const liveObjections = await tx.objection.count({
        where: { proposalId: { in: liveProposalIds }, state: 'live' },
      });
      nextState = liveObjections > 0 ? 'objected' : 'proposed';
    }

    if (nextState !== seg.state) {
      await tx.segment.update({ where: { id: segmentId }, data: { state: nextState } });
    }
    return nextState;
  }

  // ────────────────────────────────────────────────────────────
  // Custom-segment CRUD (Phase 4b) — admin only
  // ────────────────────────────────────────────────────────────

  /**
   * Add a new segment. Admin only. Respects `features.event.maxSegments`
   * (Free tier caps at 3) — counts existing segments inclusive of locked.
   */
  async createSegment(
    actorUserId: string,
    eventId: string,
    args: { title: string; segmentType: string; description?: string; position?: number },
  ) {
    await this.members.assertAdminOrThrow(actorUserId, eventId);

    const event = await this.prisma.event.findUniqueOrThrow({
      where: { id: eventId },
      select: { features: true, state: true },
    });
    if (event.state === 'archived' || event.state === 'refunded') {
      throw new ForbiddenException(`Cannot add segments to a ${event.state} event.`);
    }

    const features = (event.features ?? {}) as { event?: { maxSegments?: number | null } };
    const maxSegments = features.event?.maxSegments ?? null;

    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.segment.findMany({
        where: { eventId },
        select: { id: true, position: true },
        orderBy: { position: 'asc' },
      });

      if (maxSegments !== null && existing.length >= maxSegments) {
        throw new BadRequestException(
          `Tier cap reached — this event allows ${maxSegments} segments. Upgrade the tier or remove one first.`,
        );
      }

      const desiredPosition = args.position ?? existing.length;
      const clampedPosition = Math.max(0, Math.min(desiredPosition, existing.length));

      // Shift positions >= clampedPosition to make room. Done one at a time
      // from the end backwards to respect the (eventId, position) unique
      // index without temporary collisions.
      const toShift = existing.filter((s) => s.position >= clampedPosition).reverse();
      for (const seg of toShift) {
        await tx.segment.update({
          where: { id: seg.id },
          data: { position: seg.position + 1 },
        });
      }

      const created = await tx.segment.create({
        data: {
          eventId,
          title: args.title,
          segmentType: args.segmentType,
          description: args.description ?? null,
          position: clampedPosition,
          state: 'open',
        },
      });
      return created;
    });

    await this.audit.record({
      action: 'segment.created',
      actorUserId,
      eventId,
      details: {
        segmentId: result.id,
        title: args.title,
        segmentType: args.segmentType,
        position: result.position,
      },
    });

    this.realtime.broadcastEventChanged(eventId);
    return result;
  }

  /**
   * Update title / description / type. Admin only. Allowed even when locked
   * — renaming a locked segment is fine; payload (lockedValue) is untouched.
   */
  async updateSegment(
    actorUserId: string,
    eventId: string,
    segmentId: string,
    args: { title?: string; description?: string; segmentType?: string },
  ) {
    await this.members.assertAdminOrThrow(actorUserId, eventId);

    const segment = await this.prisma.segment.findUnique({ where: { id: segmentId } });
    if (!segment || segment.eventId !== eventId) {
      throw new NotFoundException('Segment not found');
    }

    const updated = await this.prisma.segment.update({
      where: { id: segmentId },
      data: {
        ...(args.title !== undefined && { title: args.title }),
        ...(args.segmentType !== undefined && { segmentType: args.segmentType }),
        ...(args.description !== undefined && {
          description: args.description.length === 0 ? null : args.description,
        }),
      },
    });

    await this.audit.record({
      action: 'segment.updated',
      actorUserId,
      eventId,
      details: {
        segmentId,
        changes: {
          ...(args.title !== undefined && { title: args.title }),
          ...(args.segmentType !== undefined && { segmentType: args.segmentType }),
          ...(args.description !== undefined && { description: args.description }),
        },
      },
    });

    this.realtime.broadcastEventChanged(eventId);
    return updated;
  }

  /**
   * Delete a segment. Refuses if locked (losing the decided value is a footgun)
   * or if there are any live proposals (those would orphan). To delete a
   * locked segment, unlock it first.
   */
  async deleteSegment(actorUserId: string, eventId: string, segmentId: string) {
    await this.members.assertAdminOrThrow(actorUserId, eventId);

    const segment = await this.prisma.segment.findUnique({
      where: { id: segmentId },
      include: {
        _count: { select: { proposals: { where: { state: { in: ['live', 'winner'] } } } } },
      },
    });
    if (!segment || segment.eventId !== eventId) {
      throw new NotFoundException('Segment not found');
    }
    if (segment.state === 'locked') {
      throw new ForbiddenException(
        'Segment is locked. Unlock it before deleting — locked segments hold a decided answer.',
      );
    }
    if (segment._count.proposals > 0) {
      throw new BadRequestException(
        'Segment has live proposals. Withdraw or resolve them before deleting.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.segment.delete({ where: { id: segmentId } });
      // Close the gap in positions so the remaining segments are 0..n-1.
      const remaining = await tx.segment.findMany({
        where: { eventId },
        orderBy: { position: 'asc' },
        select: { id: true, position: true },
      });
      for (let i = 0; i < remaining.length; i++) {
        if (remaining[i].position !== i) {
          await tx.segment.update({
            where: { id: remaining[i].id },
            data: { position: i },
          });
        }
      }
    });

    await this.audit.record({
      action: 'segment.deleted',
      actorUserId,
      eventId,
      details: { segmentId, title: segment.title },
    });

    this.realtime.broadcastEventChanged(eventId);
  }

  /**
   * Atomic bulk reorder. `orderedIds` must list every segment of the event
   * exactly once. Done in two passes to avoid violating the (eventId, position)
   * unique index mid-transaction: shift all to negative space first, then
   * write final positions.
   */
  async reorderSegments(actorUserId: string, eventId: string, orderedIds: string[]) {
    await this.members.assertAdminOrThrow(actorUserId, eventId);

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.segment.findMany({
        where: { eventId },
        select: { id: true },
      });
      const existingIds = new Set(existing.map((s) => s.id));
      const orderedSet = new Set(orderedIds);

      if (orderedIds.length !== existing.length || orderedSet.size !== orderedIds.length) {
        throw new BadRequestException(
          `Reorder must list all ${existing.length} segments exactly once; got ${orderedIds.length} (unique: ${orderedSet.size}).`,
        );
      }
      for (const id of orderedIds) {
        if (!existingIds.has(id)) {
          throw new BadRequestException(`Segment ${id} does not belong to this event.`);
        }
      }

      // Two-pass to avoid unique-index collisions: move every row to a
      // unique negative position, then write the final positions.
      for (let i = 0; i < orderedIds.length; i++) {
        await tx.segment.update({
          where: { id: orderedIds[i] },
          data: { position: -(i + 1) },
        });
      }
      for (let i = 0; i < orderedIds.length; i++) {
        await tx.segment.update({
          where: { id: orderedIds[i] },
          data: { position: i },
        });
      }
    });

    await this.audit.record({
      action: 'segment.reordered',
      actorUserId,
      eventId,
      details: { orderedIds },
    });

    this.realtime.broadcastEventChanged(eventId);
  }

  // ────────────────────────────────────────────────────────────
  // Lock / unlock (Phase 3c)
  // ────────────────────────────────────────────────────────────

  /**
   * Lock a segment by promoting one live proposal to the winner.
   *
   * Correctness model (per docs/04 §12):
   *   - Postgres advisory transaction-scoped lock per segment, so two concurrent
   *     lock attempts on the same segment serialize.
   *   - Serializable isolation level on the txn — guards against phantom
   *     objections appearing between the validate-read and the write.
   *
   * Rules:
   *   - Caller must own the event.
   *   - Segment must NOT already be locked.
   *   - Chosen proposal must belong to this segment.
   *   - Chosen proposal must be in state 'live'.
   *   - Chosen proposal must have zero live objections.
   *
   * Effect (atomic):
   *   - chosen proposal:     state 'live' → 'winner'
   *   - other live proposals: state 'live' → 'eliminated'
   *   - segment.lockedValue = chosen proposal payload
   *   - segment.lockedById  = caller
   *   - segment.lockedAt    = now
   *   - segment.state       = 'locked'
   *   - audit log entry 'segment.locked'
   */
  async lockSegment(
    userId: string,
    segmentId: string,
    chosenProposalId: string,
  ): Promise<void> {
    const segment = await this.assertReadableOrThrow(userId, segmentId);
    if (segment.state === 'locked') {
      throw new ConflictException('Segment is already locked.');
    }

    await this.prisma.$transaction(
      async (tx) => {
        // 1. Serialize on this segment ID. Cleared automatically at txn end.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${segmentId}))`;

        // 2. Re-read the segment inside the lock (avoid stale state from step 1).
        const seg = await tx.segment.findUniqueOrThrow({ where: { id: segmentId } });
        if (seg.state === 'locked') {
          // Someone won the race. Throw a clear conflict.
          throw new ConflictException('Segment was locked by another action.');
        }

        // 3. Validate the chosen proposal.
        const chosen = await tx.proposal.findUnique({ where: { id: chosenProposalId } });
        if (!chosen || chosen.segmentId !== segmentId) {
          throw new NotFoundException('Proposal not found on this segment.');
        }
        if (chosen.state !== 'live') {
          throw new BadRequestException(`Chosen proposal is '${chosen.state}', not 'live'.`);
        }
        const liveObjectionCount = await tx.objection.count({
          where: { proposalId: chosenProposalId, state: 'live' },
        });
        if (liveObjectionCount > 0) {
          throw new BadRequestException(
            'Cannot lock a proposal that has live objections. Withdraw or resolve them first.',
          );
        }

        // 4. Apply state changes.
        await tx.proposal.update({
          where: { id: chosenProposalId },
          data: { state: 'winner' },
        });
        await tx.proposal.updateMany({
          where: { segmentId, state: 'live', id: { not: chosenProposalId } },
          data: { state: 'eliminated' },
        });
        await tx.segment.update({
          where: { id: segmentId },
          data: {
            state: 'locked',
            lockedValue: chosen.payload as Prisma.InputJsonValue,
            lockedById: userId,
            lockedAt: new Date(),
          },
        });

        // 5. Audit inside the txn so it's atomic with the lock.
        await tx.auditLog.create({
          data: {
            action: 'segment.locked',
            actorUserId: userId,
            eventId: segment.event.id,
            details: {
              segmentId,
              chosenProposalId,
              winnerSummary: (chosen.payload as { summary?: string } | null)?.summary ?? null,
            } as Prisma.InputJsonValue,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    // Broadcast AFTER commit. Every connected tab on this event refetches.
    this.realtime.broadcastSegmentChanged(segment.event.id, segmentId);

    // Fire-and-forget: if this lock made the event publish-ready, email admins.
    void this.events.notifyPublishReadyIfApplicable(segment.event.id);
  }

  /**
   * Unlock a segment — restores live state to all proposals and clears the
   * locked value. Same concurrency model as lockSegment.
   *
   * Rules:
   *   - Caller must own the event.
   *   - Segment must currently be 'locked'.
   *
   * Effect (atomic):
   *   - winner proposal       state 'winner' → 'live'
   *   - eliminated proposals  state 'eliminated' → 'live'
   *   - segment.lockedValue   = null
   *   - segment.lockedById    = null
   *   - segment.lockedAt      = null
   *   - segment.state         = recomputed ('open' / 'proposed' / 'objected')
   *   - audit log entry 'segment.unlocked' with optional reason
   */
  async unlockSegment(
    userId: string,
    segmentId: string,
    reason: string | undefined,
  ): Promise<void> {
    const segment = await this.assertReadableOrThrow(userId, segmentId);
    if (segment.state !== 'locked') {
      throw new BadRequestException(`Segment is not locked (state: '${segment.state}').`);
    }

    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${segmentId}))`;

        const seg = await tx.segment.findUniqueOrThrow({ where: { id: segmentId } });
        if (seg.state !== 'locked') {
          throw new ConflictException('Segment is no longer locked.');
        }

        await tx.proposal.updateMany({
          where: { segmentId, state: { in: ['winner', 'eliminated'] } },
          data: { state: 'live' },
        });
        await tx.segment.update({
          where: { id: segmentId },
          data: {
            state: 'open', // recomputeState will fix this below
            lockedValue: Prisma.JsonNull,
            lockedById: null,
            lockedAt: null,
          },
        });
        await this.recomputeState(tx, segmentId);

        await tx.auditLog.create({
          data: {
            action: 'segment.unlocked',
            actorUserId: userId,
            eventId: segment.event.id,
            details: {
              segmentId,
              reason: reason ?? null,
            } as Prisma.InputJsonValue,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    this.realtime.broadcastSegmentChanged(segment.event.id, segmentId);
  }
}
