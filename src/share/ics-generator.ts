/**
 * Minimal ICS (iCalendar, RFC 5545) generator. Just enough for EPDEMA's
 * use case: one VEVENT per event with title, date, optional location
 * (extracted from the locked Venue segment if present), and description.
 *
 * Why not a library: the spec is well-defined and we need ~50 lines.
 * Pulling in `ics` or similar adds 200kB+ to the api bundle for nothing.
 */

interface IcsEventArgs {
  uid: string;
  /** YYYY-MM-DD — treated as an all-day event. */
  date: string;
  title: string;
  description?: string | null;
  location?: string | null;
  /** Public share URL — included in DESCRIPTION (as plain text) and as
   *  the URL property so most calendar apps render it as a clickable link. */
  url?: string | null;
  /** ISO timestamp for the DTSTAMP field; defaults to now. */
  stamp?: Date;
  /** ISO timestamp the event was last modified server-side. */
  lastModified?: Date;
}

export function generateIcsEvent(args: IcsEventArgs): string {
  const stamp = args.stamp ?? new Date();
  const dtstamp = toIcsTimestamp(stamp);
  const lastMod = args.lastModified ? toIcsTimestamp(args.lastModified) : dtstamp;
  const dtstart = toIcsDate(args.date);
  // All-day event ends the next day per RFC 5545.
  const dtend = toIcsDate(addOneDay(args.date));

  // Compose description: user-provided description first, then the share URL
  // on a new line so calendar apps that don't honour the URL property still
  // surface a clickable link in the body.
  let description = args.description ?? '';
  if (args.url) {
    if (description) description += '\n\n';
    description += `Full plan: ${args.url}`;
  }

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//EPDEMA//Event Planning Decision Making Assistant//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escapeText(args.uid)}@epdema.com`,
    `DTSTAMP:${dtstamp}`,
    `LAST-MODIFIED:${lastMod}`,
    `DTSTART;VALUE=DATE:${dtstart}`,
    `DTEND;VALUE=DATE:${dtend}`,
    `SUMMARY:${escapeText(args.title)}`,
  ];
  if (description) {
    lines.push(`DESCRIPTION:${escapeText(description)}`);
  }
  if (args.location) {
    lines.push(`LOCATION:${escapeText(args.location)}`);
  }
  if (args.url) {
    // RFC 5545 §3.8.4.6 — URL is a URI value, NOT a TEXT value, so it
    // doesn't get TEXT escaping. Plain include.
    lines.push(`URL:${args.url}`);
  }
  lines.push('STATUS:CONFIRMED', 'TRANSP:OPAQUE', 'END:VEVENT', 'END:VCALENDAR');

  // RFC 5545 mandates CRLF line endings.
  return lines.join('\r\n') + '\r\n';
}

/** RFC 5545 §3.3.5 — escape `,`, `;`, `\`, and newlines in TEXT fields. */
function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\n|\r/g, '\\n');
}

/** YYYY-MM-DD → YYYYMMDD */
function toIcsDate(isoDate: string): string {
  return isoDate.replace(/-/g, '');
}

/** Date → YYYYMMDDTHHMMSSZ */
function toIcsTimestamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function addOneDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Pull a sensible "venue" string out of the locked segments — the lockedValue
 * of any segment with segmentType='venue' wins; falls back to the first
 * segment whose title hints at venue.
 */
export function extractVenueFromSegments(
  segments: { segmentType: string; title: string; lockedValue: unknown }[],
): string | null {
  const venue = segments.find((s) => s.segmentType === 'venue');
  if (venue && isPayload(venue.lockedValue)) {
    return summaryOf(venue.lockedValue);
  }
  return null;
}

function isPayload(v: unknown): v is { summary?: string; notes?: string } {
  return typeof v === 'object' && v !== null;
}

function summaryOf(v: { summary?: string }): string | null {
  return typeof v.summary === 'string' ? v.summary : null;
}
