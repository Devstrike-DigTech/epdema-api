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
import { ResendAdapter } from '../notifications/resend.adapter';
import { renderInvitationEmail } from '../notifications/email-templates';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { PLANNING_ROLES, type PlanningRole } from './dto';
import { MEMBER_INCLUDE, type MemberWithUser } from './serializers';

const INVITATION_TTL_DAYS = 7;

@Injectable()
export class MembersService {
  private readonly logger = new Logger(MembersService.name);
  private readonly webOrigin: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly resend: ResendAdapter,
    private readonly realtime: RealtimeGateway,
    config: ConfigService,
  ) {
    this.webOrigin = config.getOrThrow<string>('WEB_ORIGIN');
  }

  // ────────────────────────────────────────────────────────────
  // Authorization — central helper for every other module
  // ────────────────────────────────────────────────────────────

  /**
   * Authorization check used everywhere a planning-room action happens.
   * Returns the membership row. Throws 404 (not 403) on miss so we don't
   * leak event existence to non-members.
   *
   * Phase 4 introduces this as the single source of truth — replaces the
   * old `event.creatorId === userId` checks across the codebase.
   */
  async assertMemberOrThrow(userId: string, eventId: string): Promise<MemberWithUser> {
    const member = await this.prisma.planningMember.findUnique({
      where: { eventId_userId: { eventId, userId } },
      include: MEMBER_INCLUDE,
    });
    if (!member) throw new NotFoundException('Event not found');
    return member;
  }

  /** Stricter check — used for admin-only actions (invite, remove, role change). */
  async assertAdminOrThrow(userId: string, eventId: string): Promise<MemberWithUser> {
    const member = await this.assertMemberOrThrow(userId, eventId);
    if (member.role !== 'admin') {
      throw new ForbiddenException('Only event admins can do this.');
    }
    return member;
  }

  /**
   * Called from PaymentsService.provisionEvent — adds the creator as the
   * first admin planning member. Idempotent.
   */
  async ensureCreatorMembership(
    tx: { planningMember: { upsert: (args: unknown) => Promise<unknown> } },
    eventId: string,
    creatorId: string,
  ): Promise<void> {
    await tx.planningMember.upsert({
      where: { eventId_userId: { eventId, userId: creatorId } },
      create: { eventId, userId: creatorId, role: 'admin' },
      update: {},
    } as never);
  }

  // ────────────────────────────────────────────────────────────
  // Listing
  // ────────────────────────────────────────────────────────────

  async listForEvent(userId: string, eventId: string): Promise<MemberWithUser[]> {
    await this.assertMemberOrThrow(userId, eventId);
    return this.prisma.planningMember.findMany({
      where: { eventId },
      include: MEMBER_INCLUDE,
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    });
  }

  async listInvitations(userId: string, eventId: string) {
    await this.assertAdminOrThrow(userId, eventId);
    return this.prisma.eventInvitation.findMany({
      where: { eventId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ────────────────────────────────────────────────────────────
  // Invitations
  // ────────────────────────────────────────────────────────────

  async invite(
    inviterId: string,
    eventId: string,
    email: string,
    role: PlanningRole = 'contributor',
  ) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        title: true,
        eventType: true,
        features: true,
        creator: { select: { id: true, name: true, email: true } },
      },
    });
    if (!event) throw new NotFoundException('Event not found');

    // Authorize: only admins can invite.
    await this.assertAdminOrThrow(inviterId, eventId);

    // Enforce tier cap: max planning members from features.
    const features = (event.features ?? {}) as { planning?: { maxMembers?: number | null } };
    const maxMembers = features.planning?.maxMembers ?? null;
    if (maxMembers !== null) {
      const currentMembers = await this.prisma.planningMember.count({ where: { eventId } });
      const pendingInvites = await this.prisma.eventInvitation.count({
        where: { eventId, status: 'pending' },
      });
      if (currentMembers + pendingInvites >= maxMembers) {
        throw new BadRequestException(
          `Tier cap reached (${maxMembers} planning members including pending invites). Upgrade the event tier or revoke a pending invite.`,
        );
      }
    }

    // Normalize email for collision detection.
    const normalizedEmail = email.trim().toLowerCase();

    // Don't re-invite an existing member.
    const existingMember = await this.prisma.planningMember.findFirst({
      where: { eventId, user: { email: normalizedEmail } },
    });
    if (existingMember) {
      throw new ConflictException('This email is already a member of the event.');
    }

    // Re-issue if there's an existing pending invite — keeps one row per email.
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

    const invitation = await this.prisma.eventInvitation.upsert({
      where: { eventId_email: { eventId, email: normalizedEmail } },
      create: {
        eventId,
        email: normalizedEmail,
        role,
        token,
        status: 'pending',
        expiresAt,
        inviterId,
      },
      update: {
        role,
        token,
        status: 'pending',
        expiresAt,
        inviterId,
        acceptedAt: null,
      },
    });

    // Send email — best-effort. If delivery fails (Resend sandbox limits,
    // bounce, etc.) the invitation still exists and the admin can copy the
    // link from the response and share it manually.
    const acceptUrl = `${this.webOrigin}/invitations/${token}`;
    const inviterName = event.creator.name || event.creator.email;
    const { subject, html, text } = renderInvitationEmail({
      eventTitle: event.title,
      eventType: event.eventType,
      inviterName,
      acceptUrl,
    });

    let emailSent = true;
    let emailError: string | null = null;
    try {
      await this.resend.send({ to: normalizedEmail, subject, html, text });
    } catch (err) {
      emailSent = false;
      emailError = err instanceof Error ? err.message : 'unknown';
      this.logger.warn(
        `Invitation email delivery failed for ${normalizedEmail} (${emailError}). ` +
          `Admin can share this link manually: ${acceptUrl}`,
      );
    }

    await this.audit.record({
      action: 'member.invited',
      actorUserId: inviterId,
      eventId,
      details: {
        email: normalizedEmail,
        role,
        invitationId: invitation.id,
        emailSent,
        ...(emailError && { emailError }),
      },
    });

    this.realtime.broadcastEventChanged(eventId);

    // Returned fields beyond the row are not on the standard EventInvitation
    // type — the controller serializer keeps the row clean and adds these
    // separately so admins can copy + share when email is unreliable.
    return { invitation, acceptUrl, emailSent, emailError };
  }

  async revokeInvitation(actorUserId: string, eventId: string, invitationId: string) {
    await this.assertAdminOrThrow(actorUserId, eventId);
    const inv = await this.prisma.eventInvitation.findUnique({ where: { id: invitationId } });
    if (!inv || inv.eventId !== eventId) throw new NotFoundException('Invitation not found');
    if (inv.status !== 'pending') {
      throw new BadRequestException(`Invitation is already '${inv.status}'.`);
    }
    await this.prisma.eventInvitation.update({
      where: { id: invitationId },
      data: { status: 'revoked' },
    });
    await this.audit.record({
      action: 'member.invitation_revoked',
      actorUserId,
      eventId,
      details: { invitationId, email: inv.email },
    });
    this.realtime.broadcastEventChanged(eventId);
  }

  // ────────────────────────────────────────────────────────────
  // Acceptance (called from the public invitation endpoint)
  // ────────────────────────────────────────────────────────────

  async lookupByToken(token: string) {
    return this.prisma.eventInvitation.findUnique({
      where: { token },
      include: {
        event: { select: { id: true, title: true, eventType: true, scheduledDate: true } },
        inviter: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async acceptInvitation(userId: string, userEmail: string, token: string): Promise<{ eventId: string }> {
    const inv = await this.prisma.eventInvitation.findUnique({ where: { token } });
    if (!inv) throw new NotFoundException('Invitation not found');
    if (inv.status !== 'pending') {
      throw new BadRequestException(`Invitation is ${inv.status}.`);
    }
    if (inv.expiresAt.getTime() < Date.now()) {
      await this.prisma.eventInvitation.update({
        where: { id: inv.id },
        data: { status: 'expired' },
      });
      throw new BadRequestException('Invitation has expired. Ask for a fresh one.');
    }
    if (inv.email.toLowerCase() !== userEmail.toLowerCase()) {
      throw new ForbiddenException(
        `This invitation was sent to ${inv.email}; you're signed in as ${userEmail}. Sign in with the invited email to accept.`,
      );
    }

    // Atomic: add membership, mark invitation accepted.
    await this.prisma.$transaction(async (tx) => {
      await tx.planningMember.upsert({
        where: { eventId_userId: { eventId: inv.eventId, userId } },
        create: {
          eventId: inv.eventId,
          userId,
          role: inv.role,
          invitedById: inv.inviterId,
        },
        update: {}, // already a member — no-op
      });
      await tx.eventInvitation.update({
        where: { id: inv.id },
        data: { status: 'accepted', acceptedAt: new Date() },
      });
    });

    await this.audit.record({
      action: 'member.accepted',
      actorUserId: userId,
      eventId: inv.eventId,
      details: { invitationId: inv.id, role: inv.role },
    });

    this.realtime.broadcastEventChanged(inv.eventId);

    return { eventId: inv.eventId };
  }

  // ────────────────────────────────────────────────────────────
  // Role change / remove
  // ────────────────────────────────────────────────────────────

  async updateRole(
    actorUserId: string,
    eventId: string,
    memberId: string,
    role: PlanningRole,
  ): Promise<MemberWithUser> {
    if (!PLANNING_ROLES.includes(role)) {
      throw new BadRequestException(`Invalid role: ${role}`);
    }
    await this.assertAdminOrThrow(actorUserId, eventId);

    const target = await this.prisma.planningMember.findUnique({ where: { id: memberId } });
    if (!target || target.eventId !== eventId) throw new NotFoundException('Member not found');

    // Don't allow demoting the last admin (locks the event out of admin actions).
    if (target.role === 'admin' && role !== 'admin') {
      const adminCount = await this.prisma.planningMember.count({
        where: { eventId, role: 'admin' },
      });
      if (adminCount <= 1) {
        throw new BadRequestException(
          'Cannot demote the only admin. Promote another member first.',
        );
      }
    }

    const updated = await this.prisma.planningMember.update({
      where: { id: memberId },
      data: { role },
      include: MEMBER_INCLUDE,
    });

    await this.audit.record({
      action: 'member.role_changed',
      actorUserId,
      eventId,
      details: { memberId, userId: target.userId, fromRole: target.role, toRole: role },
    });

    this.realtime.broadcastEventChanged(eventId);

    return updated;
  }

  async remove(actorUserId: string, eventId: string, memberId: string): Promise<void> {
    await this.assertAdminOrThrow(actorUserId, eventId);
    const target = await this.prisma.planningMember.findUnique({ where: { id: memberId } });
    if (!target || target.eventId !== eventId) throw new NotFoundException('Member not found');

    if (target.role === 'admin') {
      const adminCount = await this.prisma.planningMember.count({
        where: { eventId, role: 'admin' },
      });
      if (adminCount <= 1) {
        throw new BadRequestException('Cannot remove the only admin.');
      }
    }

    await this.prisma.planningMember.delete({ where: { id: memberId } });

    await this.audit.record({
      action: 'member.removed',
      actorUserId,
      eventId,
      details: { memberId, userId: target.userId, role: target.role },
    });

    this.realtime.broadcastEventChanged(eventId);
  }
}
