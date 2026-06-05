/**
 * "See you tomorrow" email — sent ~24h before the event to anyone who's
 * responded yes or maybe. Day-of logistics nudge, not a sales pitch.
 *
 * Phase 5c — `sharing.emailReminders` (Gathering+).
 */
import { renderEmailLayout, escapeHtml } from './_layout';

interface TomorrowArgs {
  eventTitle: string;
  scheduledDateDisplay: string | null;
  organizerName: string;
  rsvpUrl: string;
  shareUrl: string | null;
  icsUrl: string | null;
  recipientName: string | null;
  status: 'yes' | 'maybe';
}

export function renderEventTomorrowEmail({
  eventTitle,
  scheduledDateDisplay,
  organizerName,
  rsvpUrl,
  shareUrl,
  icsUrl,
  recipientName,
  status,
}: TomorrowArgs): { subject: string; html: string; text: string } {
  const greeting = recipientName ? `Hi ${escapeHtml(recipientName)},` : 'Hi,';
  const subject =
    status === 'yes'
      ? `See you tomorrow at "${eventTitle}"`
      : `Tomorrow: "${eventTitle}" — final headcount`;
  const intro =
    status === 'yes'
      ? `Just a heads-up that <strong>${escapeHtml(eventTitle)}</strong> is tomorrow.
        ${escapeHtml(organizerName)} is looking forward to seeing you.`
      : `<strong>${escapeHtml(eventTitle)}</strong> is tomorrow and we have you down as a maybe.
        If you can pin it down now it'd really help ${escapeHtml(organizerName)} with the final headcount.`;
  const preheader =
    status === 'yes'
      ? `${eventTitle} is tomorrow${scheduledDateDisplay ? ` · ${scheduledDateDisplay}` : ''}. Add to calendar + see the plan.`
      : `Final headcount tomorrow — yes or no?`;

  const contentHtml = `
    <p style="font-size:18px;line-height:1.4;margin:0 0 8px;color:#1F1230;font-family:'Source Serif 4',Georgia,serif;" class="epd-ink">"${escapeHtml(eventTitle)}"</p>
    ${scheduledDateDisplay ? `<p style="font-size:14px;color:#877A91;margin:0 0 24px;" class="epd-soft">${escapeHtml(scheduledDateDisplay)}</p>` : '<div style="height:8px"></div>'}
    <p style="font-size:15px;line-height:1.6;color:#4A3D5B;margin:0 0 24px;" class="epd-ink">
      ${greeting} ${intro}
    </p>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin:0 0 8px;">
      ${shareUrl ? `<a href="${shareUrl}" style="display:inline-block;background:#E8A93D;color:#1F1230;font-weight:600;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;">See the plan</a>` : ''}
      ${icsUrl ? `<a href="${icsUrl}" style="display:inline-block;background:#FAF7F2;color:#1F1230;border:1px solid #E5DED1;font-weight:500;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;">Add to calendar</a>` : ''}
      <a href="${rsvpUrl}" style="display:inline-block;background:#FAF7F2;color:#1F1230;border:1px solid #E5DED1;font-weight:500;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;">Update RSVP</a>
    </div>`;

  const html = renderEmailLayout({
    eyebrow: 'EPDEMA · Day-before reminder',
    heading: status === 'yes' ? 'See you tomorrow.' : 'Tomorrow — still in?',
    preheader,
    contentHtml,
    belowFooterNote:
      "Plans change — you can still flip yes / no / maybe right up to the event.",
  });

  const text =
    `${greeting} ${eventTitle} is tomorrow${scheduledDateDisplay ? ` (${scheduledDateDisplay})` : ''}.\n\n` +
    (shareUrl ? `Plan: ${shareUrl}\n` : '') +
    (icsUrl ? `Calendar: ${icsUrl}\n` : '') +
    `Update RSVP: ${rsvpUrl}\n`;

  return { subject, html, text };
}
