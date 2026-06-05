import { Prisma } from '@prisma/client';

/**
 * Include shape used by every endpoint that returns a Proposal — keeps the
 * wire format consistent so the frontend `ProposalDto` is always satisfied
 * (proposedBy + objections + each objection's raisedBy always present).
 */
export const PROPOSAL_INCLUDE = {
  proposedBy: { select: { id: true, name: true, email: true } },
  objections: {
    where: { state: 'live' },
    orderBy: { createdAt: 'asc' as const },
    include: {
      raisedBy: { select: { id: true, name: true, email: true } },
    },
  },
} satisfies Prisma.ProposalInclude;

export type ProposalWithRelations = Prisma.ProposalGetPayload<{
  include: typeof PROPOSAL_INCLUDE;
}>;

export function serializeProposal(proposal: ProposalWithRelations) {
  return {
    id: proposal.id,
    segmentId: proposal.segmentId,
    proposedById: proposal.proposedById,
    proposedBy: proposal.anonymous
      ? null
      : {
          id: proposal.proposedBy.id,
          name: proposal.proposedBy.name,
          email: proposal.proposedBy.email,
        },
    anonymous: proposal.anonymous,
    payload: proposal.payload,
    state: proposal.state,
    createdAt: proposal.createdAt.toISOString(),
    updatedAt: proposal.updatedAt.toISOString(),
    objections: proposal.objections.map((o) => ({
      id: o.id,
      proposalId: o.proposalId,
      raisedById: o.raisedById,
      raisedBy: {
        id: o.raisedBy.id,
        name: o.raisedBy.name,
        email: o.raisedBy.email,
      },
      reason: o.reason,
      state: o.state,
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
    })),
  };
}
