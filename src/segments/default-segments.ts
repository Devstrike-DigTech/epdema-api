/**
 * Default segment templates per event type. Created automatically when an
 * event provisions. Trimmed to `features.event.maxSegments` if set
 * (Free tier caps at 3).
 *
 * Priority order matters — the first N are the most universal; if a tier
 * caps segments, the tail gets dropped.
 */

import type { EventType } from '../events/dto/create-event-draft.dto';

export interface SegmentTemplate {
  segmentType: string;
  title: string;
  description: string;
}

/** Universal core — present in every event type, ordered by priority. */
const CORE: SegmentTemplate[] = [
  {
    segmentType: 'date_time',
    title: 'Date & time',
    description: 'When the event happens. Locks the calendar, drives reminders.',
  },
  {
    segmentType: 'venue',
    title: 'Venue',
    description: 'Where it happens. Includes capacity, parking, accessibility notes.',
  },
  {
    segmentType: 'budget',
    title: 'Budget envelope',
    description: 'The overall ceiling. Itemized costs reconcile against this in real time on Occasion+ tiers.',
  },
];

/** Type-specific extras — appended after CORE, dropped first if quota cap hits. */
const EXTRAS: Record<EventType, SegmentTemplate[]> = {
  wedding: [
    { segmentType: 'agenda', title: 'Run of show', description: 'Order of events, who walks when.' },
    { segmentType: 'guest_list', title: 'Guest list', description: 'Who is invited and which side they sit on.' },
    { segmentType: 'roles', title: 'Roles & responsibilities', description: 'MC, ushers, photographer point-of-contact.' },
  ],
  birthday: [
    { segmentType: 'theme', title: 'Theme & vibe', description: 'Theme, colors, dress code.' },
    { segmentType: 'guest_list', title: 'Guest list', description: 'Who is invited.' },
  ],
  offsite: [
    { segmentType: 'agenda', title: 'Agenda', description: 'Sessions, breaks, social.' },
    { segmentType: 'travel', title: 'Travel & logistics', description: 'How everyone gets there and back.' },
    { segmentType: 'roles', title: 'Roles', description: 'Facilitators, scribes, presenters.' },
  ],
  hangout: [],
  conference: [
    { segmentType: 'agenda', title: 'Agenda', description: 'Track schedule, keynotes, breaks.' },
    { segmentType: 'roles', title: 'Roles', description: 'Speakers, MCs, registration desk.' },
    { segmentType: 'guest_list', title: 'Attendee list', description: 'Who is registered.' },
  ],
  reunion: [
    { segmentType: 'guest_list', title: 'Guest list', description: 'Who is invited.' },
  ],
  fundraiser: [
    { segmentType: 'agenda', title: 'Programme', description: 'Pitches, auction, performances.' },
    { segmentType: 'guest_list', title: 'Guest list', description: 'Invitees & sponsors.' },
  ],
  other: [],
};

/**
 * Build the ordered default-segment list for an event, respecting the
 * tier's maxSegments cap. The priority order is: CORE first, then EXTRAS
 * for the event type — so a Free-tier wedding gets date/venue/budget
 * even though those are the only 3 it's allowed.
 */
export function defaultSegmentsFor(
  eventType: EventType,
  maxSegments: number | null | undefined,
): SegmentTemplate[] {
  const all = [...CORE, ...(EXTRAS[eventType] ?? [])];
  if (maxSegments == null) return all;
  return all.slice(0, maxSegments);
}
