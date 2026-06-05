import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../infra/audit/audit.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { MembersService } from '../../members/members.service';
import { SegmentsService } from '../segments.service';
import type { CreateProposalDto } from './dto';
import { PROPOSAL_INCLUDE, type ProposalWithRelations } from './serializers';

@Injectable()
export class ProposalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly segments: SegmentsService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
    private readonly members: MembersService,
  ) {}

  async listForSegment(userId: string, segmentId: string): Promise<ProposalWithRelations[]> {
    await this.segments.assertReadableOrThrow(userId, segmentId);
    return this.prisma.proposal.findMany({
      where: { segmentId, state: { in: ['live', 'winner'] } },
      orderBy: { createdAt: 'asc' },
      include: PROPOSAL_INCLUDE,
    });
  }

  async create(
    userId: string,
    segmentId: string,
    dto: CreateProposalDto,
  ): Promise<ProposalWithRelations> {
    const segment = await this.segments.assertMutableOrThrow(userId, segmentId);

    const payload: Record<string, unknown> = { summary: dto.summary };
    if (dto.notes) payload.notes = dto.notes;
    if (dto.typed) payload.typed = dto.typed;

    const proposalId = await this.prisma.$transaction(async (tx) => {
      const proposal = await tx.proposal.create({
        data: {
          segmentId: segment.id,
          proposedById: userId,
          payload: payload as Prisma.InputJsonValue,
          state: 'live',
          // anonymous flag from features.room.anonymousProposals is Phase 8;
          // default false for now.
          anonymous: false,
        },
      });
      await this.segments.recomputeState(tx, segment.id);
      return proposal.id;
    });

    await this.audit.record({
      action: 'proposal.created',
      actorUserId: userId,
      eventId: segment.event.id,
      details: { proposalId, segmentId: segment.id, summary: dto.summary },
    });

    // Broadcast AFTER commit. Other tabs / users in the room refetch.
    this.realtime.broadcastSegmentChanged(segment.event.id, segment.id);

    // Re-fetch with relations so the response matches ProposalDto on the wire.
    return this.prisma.proposal.findUniqueOrThrow({
      where: { id: proposalId },
      include: PROPOSAL_INCLUDE,
    });
  }

  async withdraw(userId: string, proposalId: string): Promise<ProposalWithRelations> {
    const existing = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      include: { segment: { include: { event: { select: { id: true, creatorId: true } } } } },
    });
    if (!existing) throw new NotFoundException('Proposal not found');

    // Membership check (any planning member can see this proposal exists).
    const actor = await this.members
      .assertMemberOrThrow(userId, existing.segment.event.id)
      .catch(() => {
        // Throw not-found (not 403) so non-members can't probe for proposals.
        throw new NotFoundException('Proposal not found');
      });

    // Proposer can always withdraw their own. Admins can withdraw any.
    if (existing.proposedById !== userId && actor.role !== 'admin') {
      throw new ForbiddenException(
        'Only the proposer (or an event admin) can withdraw this proposal.',
      );
    }
    if (existing.state !== 'live') {
      throw new BadRequestException(`Proposal is already '${existing.state}'.`);
    }
    if (existing.segment.state === 'locked') {
      throw new ForbiddenException('Segment is locked; cannot withdraw.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.proposal.update({
        where: { id: proposalId },
        data: { state: 'withdrawn' },
      });
      // Withdrawing a proposal also withdraws all live objections against it
      // (they no longer have a target).
      await tx.objection.updateMany({
        where: { proposalId, state: 'live' },
        data: { state: 'withdrawn' },
      });
      await this.segments.recomputeState(tx, existing.segmentId);
    });

    await this.audit.record({
      action: 'proposal.withdrawn',
      actorUserId: userId,
      eventId: existing.segment.event.id,
      details: { proposalId, segmentId: existing.segmentId },
    });

    this.realtime.broadcastSegmentChanged(existing.segment.event.id, existing.segmentId);

    return this.prisma.proposal.findUniqueOrThrow({
      where: { id: proposalId },
      include: PROPOSAL_INCLUDE,
    });
  }
}
