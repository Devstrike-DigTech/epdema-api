import { Prisma } from '@prisma/client';

export const MEMBER_INCLUDE = {
  user: { select: { id: true, name: true, email: true, image: true } },
} satisfies Prisma.PlanningMemberInclude;

export type MemberWithUser = Prisma.PlanningMemberGetPayload<{ include: typeof MEMBER_INCLUDE }>;

export function serializeMember(m: MemberWithUser) {
  return {
    id: m.id,
    eventId: m.eventId,
    userId: m.userId,
    role: m.role,
    joinedAt: m.joinedAt.toISOString(),
    invitedById: m.invitedById,
    user: {
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      image: m.user.image,
    },
  };
}

export function serializeInvitation(inv: {
  id: string;
  eventId: string;
  email: string;
  role: string;
  status: string;
  expiresAt: Date;
  inviterId: string;
  createdAt: Date;
  acceptedAt: Date | null;
}) {
  return {
    id: inv.id,
    eventId: inv.eventId,
    email: inv.email,
    role: inv.role,
    status: inv.status,
    expiresAt: inv.expiresAt.toISOString(),
    inviterId: inv.inviterId,
    createdAt: inv.createdAt.toISOString(),
    acceptedAt: inv.acceptedAt?.toISOString() ?? null,
  };
}

/** Public view shown to a recipient who hits /invitations/:token */
export function serializePublicInvitation(args: {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: Date;
  event: { id: string; title: string; eventType: string; scheduledDate: Date | null };
  inviter: { id: string; name: string | null; email: string };
}) {
  return {
    id: args.id,
    email: args.email,
    role: args.role,
    status: args.status,
    expiresAt: args.expiresAt.toISOString(),
    event: {
      id: args.event.id,
      title: args.event.title,
      eventType: args.event.eventType,
      scheduledDate: args.event.scheduledDate ? args.event.scheduledDate.toISOString().slice(0, 10) : null,
    },
    inviter: {
      id: args.inviter.id,
      name: args.inviter.name,
      email: args.inviter.email,
    },
  };
}
