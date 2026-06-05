import type { Prisma } from '@prisma/client';

/**
 * Phase 7·F — the creator now optionally surfaces their EPDEMA-side profile
 * row so we can include rating data. The relation is `userProfile?` because
 * a user might not have one yet (Better Auth creates the user without a
 * profile; UsersService lazy-creates on first /users/me hit).
 */
type EventWithPublic = Prisma.EventGetPayload<{
  include: {
    creator: {
      select: {
        id: true;
        name: true;
        profile: {
          select: {
            ratingAvg: true;
            ratingCount: true;
            ratingVisible: true;
          };
        };
      };
    };
    segments: {
      select: {
        id: true;
        title: true;
        segmentType: true;
        description: true;
        position: true;
        lockedValue: true;
        lockedAt: true;
      };
    };
  };
}>;

/**
 * Public-safe event shape. Mind the field budget — any field added here is
 * visible to anyone with the share URL.
 *
 * Phase 7·F:
 *   - `creator.rating` is included ONLY when `userProfile.ratingVisible !== false`
 *     AND the user has at least one review. Default-true semantics: if the
 *     profile doesn't exist yet OR ratingVisible is null, we treat it as
 *     "yes, show the rating" — opt-out, not opt-in. The trust signal is
 *     valuable enough that we surface it by default for users who haven't
 *     explicitly hidden it.
 *   - `count === 0` → still omit. A "0 reviews" badge is worse than no badge.
 *   - The avg is returned as a string (Prisma Decimal → string) so the wire
 *     format matches what /users/me returns. Web clients can `Number()` it.
 */
export function serializePublicEvent(event: EventWithPublic) {
  const profile = event.creator.profile;
  // `false` only when explicitly opted out; null/undefined keeps the default-on behaviour.
  const ratingVisible = profile?.ratingVisible !== false;
  const hasReviews = (profile?.ratingCount ?? 0) > 0;
  const includeRating = ratingVisible && hasReviews;

  return {
    id: event.id,
    title: event.title,
    eventType: event.eventType,
    description: event.description,
    scheduledDate: event.scheduledDate ? event.scheduledDate.toISOString().slice(0, 10) : null,
    state: event.state,
    shareSlug: event.shareSlug,
    publishedAt: event.publishedAt?.toISOString() ?? null,
    creator: {
      name: event.creator.name,
      // Two nullable fields so consumers can render with a single check
      // (`creator.ratingAvg != null`). Splitting `rating` into a nested
      // object would make the web client juggle one more layer.
      ratingAvg: includeRating ? profile!.ratingAvg!.toString() : null,
      ratingCount: includeRating ? profile!.ratingCount : 0,
    },
    decisions: event.segments.map((s) => ({
      id: s.id,
      title: s.title,
      segmentType: s.segmentType,
      description: s.description,
      position: s.position,
      value: s.lockedValue,
      decidedAt: s.lockedAt?.toISOString() ?? null,
    })),
  };
}
