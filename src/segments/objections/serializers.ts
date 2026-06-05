import { Prisma } from '@prisma/client';

/** Always return `raisedBy` so the frontend `ObjectionDto` is satisfied. */
export const OBJECTION_INCLUDE = {
  raisedBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.ObjectionInclude;

export type ObjectionWithRelations = Prisma.ObjectionGetPayload<{
  include: typeof OBJECTION_INCLUDE;
}>;

export function serializeObjection(objection: ObjectionWithRelations) {
  return {
    id: objection.id,
    proposalId: objection.proposalId,
    raisedById: objection.raisedById,
    raisedBy: {
      id: objection.raisedBy.id,
      name: objection.raisedBy.name,
      email: objection.raisedBy.email,
    },
    reason: objection.reason,
    state: objection.state,
    createdAt: objection.createdAt.toISOString(),
    updatedAt: objection.updatedAt.toISOString(),
  };
}
