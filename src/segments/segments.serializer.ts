import type { Segment } from '@prisma/client';
import type { SegmentWithDetail } from './segments.service';

export function serializeSegment(segment: Segment) {
  return {
    id: segment.id,
    eventId: segment.eventId,
    segmentType: segment.segmentType,
    title: segment.title,
    description: segment.description,
    position: segment.position,
    state: segment.state,
    lockedValue: segment.lockedValue,
    lockedAt: segment.lockedAt?.toISOString() ?? null,
    lockedById: segment.lockedById,
    createdAt: segment.createdAt.toISOString(),
    updatedAt: segment.updatedAt.toISOString(),
  };
}

export function serializeSegmentDetail(segment: SegmentWithDetail) {
  return {
    ...serializeSegment(segment),
    proposals: segment.proposals.map((p) => ({
      id: p.id,
      segmentId: p.segmentId,
      proposedById: p.proposedById,
      proposedBy: p.anonymous
        ? null // mask author when anonymous_proposals add-on is enabled (Phase 8)
        : { id: p.proposedBy.id, name: p.proposedBy.name, email: p.proposedBy.email },
      anonymous: p.anonymous,
      payload: p.payload,
      state: p.state,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      objections: p.objections.map((o) => ({
        id: o.id,
        proposalId: o.proposalId,
        raisedById: o.raisedById,
        raisedBy: { id: o.raisedBy.id, name: o.raisedBy.name, email: o.raisedBy.email },
        reason: o.reason,
        state: o.state,
        createdAt: o.createdAt.toISOString(),
        updatedAt: o.updatedAt.toISOString(),
      })),
    })),
  };
}
