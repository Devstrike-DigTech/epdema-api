/**
 * Stable names for everything that touches BullMQ. Keeping them in one file
 * means a typo in the worker will fail loudly instead of silently dispatching
 * to a queue nobody's listening on.
 */

/** The single BullMQ queue we use for all background work. */
export const QUEUE_NAME = 'epdema';

/** Discriminator on every job's `name` field. The processor switches on this. */
export const JOB_NAMES = {
  rsvpNudge: 'rsvp-nudge',
  eventTomorrow: 'event-tomorrow',
  /** Phase 7·D — hourly scan that flips eligible `published` events to `past`. */
  pastStateScan: 'past-state-scan',
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

/**
 * Conventional job-id schemes — used so we can find/cancel a job from outside
 * the queue's own bookkeeping (e.g. on unpublish).
 *
 * NOTE: BullMQ ≥5 forbids `:` in custom job-ids (Redis treats it as a key
 * namespace separator and Bull's internal key composition collides). Use `-`.
 */
export const jobIdFor = {
  rsvpNudge: (inviteeId: string) => `nudge-${inviteeId}`,
  eventTomorrow: (eventId: string) => `tomorrow-${eventId}`,
  /** Singleton for the repeatable scan — we want exactly one instance ever. */
  pastStateScan: () => 'past-state-scan-singleton',
} as const;
