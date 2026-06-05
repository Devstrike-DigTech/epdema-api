import type { EventInvitee } from '@prisma/client';
import { extractQuestions } from './invitees.service';

/**
 * Admin-facing invitee shape. Includes RSVP token (admin can reshare it
 * out-of-band if email failed) and addedAt audit fields.
 */
export function serializeInviteeAdmin(invitee: EventInvitee) {
  return {
    id: invitee.id,
    eventId: invitee.eventId,
    email: invitee.email,
    name: invitee.name,
    status: invitee.status,
    rsvpToken: invitee.rsvpToken,
    customAnswers: invitee.customAnswers,
    addedById: invitee.addedById,
    addedAt: invitee.addedAt.toISOString(),
    invitedAt: invitee.invitedAt?.toISOString() ?? null,
    respondedAt: invitee.respondedAt?.toISOString() ?? null,
  };
}

/**
 * Public RSVP lookup shape. Token is in the URL; we echo back the event
 * essentials + the invitee's status + their email so the form can pre-fill.
 * No PII beyond the invitee's own email + name.
 */
export function serializePublicRsvpView(
  invitee: EventInvitee,
  event: {
    id: string;
    title: string;
    eventType: string;
    scheduledDate: Date | null;
    description: string | null;
    shareSlug: string | null;
    rsvpQuestions: unknown;
  },
  /**
   * Optional pre-serialized brand payload (already gated on the tier feature
   * flag by the caller — pass `null` when branding doesn't apply). Kept as a
   * fourth argument so existing call sites without branding context still work.
   */
  brand: unknown = null,
) {
  return {
    invitee: {
      id: invitee.id,
      email: invitee.email,
      name: invitee.name,
      status: invitee.status,
      customAnswers: invitee.customAnswers,
      respondedAt: invitee.respondedAt?.toISOString() ?? null,
    },
    event: {
      id: event.id,
      title: event.title,
      eventType: event.eventType,
      scheduledDate: event.scheduledDate ? event.scheduledDate.toISOString().slice(0, 10) : null,
      description: event.description,
      shareSlug: event.shareSlug,
      // Public — the questions are public anyway because the RSVP page renders
      // them. We don't expose existing answers from *other* invitees, only the
      // viewer's own (already on `invitee.customAnswers` above).
      rsvpQuestions: extractQuestions(event.rsvpQuestions),
      brand,
    },
  };
}
