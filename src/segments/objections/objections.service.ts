import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../infra/audit/audit.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { MembersService } from '../../members/members.service';
import { SegmentsService } from '../segments.service';
import type { CreateObjectionDto } from './dto';
import { OBJECTION_INCLUDE, type ObjectionWithRelations } from './serializers';

@Injectable()
export class ObjectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly segments: SegmentsService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
    private readonly members: MembersService,
  ) {}

  async listForProposal(userId: string, proposalId: string): Promise<ObjectionWithRelations[]> {
    const proposal = await this.lookupAndAuthorize(userId, proposalId);
    return this.prisma.objection.findMany({
      where: { proposalId: proposal.id, state: 'live' },
      orderBy: { createdAt: 'asc' },
      include: OBJECTION_INCLUDE,
    });
  }

  async create(
    userId: string,
    proposalId: string,
    dto: CreateObjectionDto,
  ): Promise<ObjectionWithRelations> {
    const proposal = await this.lookupAndAuthorize(userId, proposalId);
    if (proposal.state !== 'live') {
      throw new BadRequestException(`Cannot object to a ${proposal.state} proposal.`);
    }
    if (proposal.segment.state === 'locked') {
      throw new ForbiddenException('Segment is locked; cannot raise an objection.');
    }
    // A user can have at most one live objection per proposal — a second
    // objection from the same person is just noise.
    const existing = await this.prisma.objection.findFirst({
      where: { proposalId, raisedById: userId, state: 'live' },
    });
    if (existing) {
      throw new BadRequestException('You already have a live objection on this proposal.');
    }

    const objectionId = await this.prisma.$transaction(async (tx) => {
      const o = await tx.objection.create({
        data: {
          proposalId,
          raisedById: userId,
          reason: dto.reason ?? null,
          state: 'live',
        },
      });
      await this.segments.recomputeState(tx, proposal.segmentId);
      return o.id;
    });

    await this.audit.record({
      action: 'objection.raised',
      actorUserId: userId,
      eventId: proposal.segment.event.id,
      details: {
        objectionId,
        proposalId,
        segmentId: proposal.segmentId,
        hasReason: Boolean(dto.reason),
      },
    });

    this.realtime.broadcastSegmentChanged(proposal.segment.event.id, proposal.segmentId);

    return this.prisma.objection.findUniqueOrThrow({
      where: { id: objectionId },
      include: OBJECTION_INCLUDE,
    });
  }

  async withdraw(userId: string, objectionId: string): Promise<ObjectionWithRelations> {
    const existing = await this.prisma.objection.findUnique({
      where: { id: objectionId },
      include: {
        proposal: {
          include: { segment: { include: { event: { select: { id: true, creatorId: true } } } } },
        },
      },
    });
    if (!existing) throw new NotFoundException('Objection not found');

    const actor = await this.members
      .assertMemberOrThrow(userId, existing.proposal.segment.event.id)
      .catch(() => {
        throw new NotFoundException('Objection not found');
      });

    // Objector can withdraw their own; event admin can withdraw any.
    if (existing.raisedById !== userId && actor.role !== 'admin') {
      throw new ForbiddenException(
        'Only the objector (or an event admin) can withdraw this objection.',
      );
    }
    if (existing.state !== 'live') {
      throw new BadRequestException(`Objection is already '${existing.state}'.`);
    }
    if (existing.proposal.segment.state === 'locked') {
      throw new ForbiddenException('Segment is locked; cannot withdraw.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.objection.update({
        where: { id: objectionId },
        data: { state: 'withdrawn' },
      });
      await this.segments.recomputeState(tx, existing.proposal.segmentId);
    });

    await this.audit.record({
      action: 'objection.withdrawn',
      actorUserId: userId,
      eventId: existing.proposal.segment.event.id,
      details: { objectionId, proposalId: existing.proposalId, segmentId: existing.proposal.segmentId },
    });

    this.realtime.broadcastSegmentChanged(existing.proposal.segment.event.id, existing.proposal.segmentId);

    return this.prisma.objection.findUniqueOrThrow({
      where: { id: objectionId },
      include: OBJECTION_INCLUDE,
    });
  }

  /**
   * Shared helper — load a proposal with its segment + event and verify
   * the user is a planning member. Returns the proposal (with relations)
   * for downstream use.
   */
  private async lookupAndAuthorize(userId: string, proposalId: string) {
    const proposal = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      include: {
        segment: { include: { event: { select: { id: true, creatorId: true } } } },
      },
    });
    if (!proposal) throw new NotFoundException('Proposal not found');
    await this.members.assertMemberOrThrow(userId, proposal.segment.event.id).catch(() => {
      throw new NotFoundException('Proposal not found');
    });
    return proposal;
  }
}
