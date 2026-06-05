/**
 * RSVP nudge — sent 3 days after the initial invitation to invitees who
 * haven't replied yet. Friendly, not naggy.
 *
 * Phase 5c — `sharing.emailReminders` (Gathering+).
 */
import { renderEmailLayout, escapeHtml } from './_layout';

interface NudgeArgs {
  eventTitle: string;
  scheduledDateDisplay: string | null;
  organizerName: string;
  rsvpUrl: string;
  recipientName: string | null;
}

export function renderRsvpNudgeEmail({
  eventTitle,
  scheduledDateDisplay,
  organizerName,
  rsvpUrl,
  recipientName,
}: NudgeArgs): { subject: string; html: string; text: string } {
  const subject = `Quick reminder — RSVP to "${eventTitle}"`;
  const greeting = recipientName ? `Hi ${escapeHtml(recipientName)},` : 'Hi,';
  const preheader = `A quick yes / no / maybe helps ${organizerName} with the planning.`;

  const contentHtml = `
    <p style="font-size:18px;line-height:1.4;margin:0 0 8px;color:#1F1230;font-family:'Source Serif 4',Georgia,serif;" class="epd-ink">"${escapeHtml(eventTitle)}"</p>
    ${scheduledDateDisplay ? `<p style="font-size:14px;color:#877A91;margin:0 0 24px;" class="epd-soft">${escapeHtml(scheduledDateDisplay)}</p>` : '<div style="height:8px"></div>'}
    <p style="font-size:15px;line-height:1.6;color:#4A3D5B;margin:0 0 8px;" class="epd-ink">
      ${greeting} ${escapeHtml(organizerName)} sent you an invite a few days back and we haven't heard
      from you yet. A quick yes / no / maybe helps the planning — no commitment beyond that.
    </p>`;

  const html = renderEmailLayout({
    eyebrow: 'EPDEMA · Friendly nudge',
    heading: 'Still figuring it out?',
    preheader,
    contentHtml,
    cta: { label: 'RSVP now', url: rsvpUrl },
    ctaFootnote: 'Or paste this link into your browser:',
    belowFooterNote: "This is the only reminder we'll send. Promise.",
  });

  const text =
    `${greeting} ${organizerName} sent you an invite to ${eventTitle}${scheduledDateDisplay ? ` (${scheduledDateDisplay})` : ''} a few days back — a quick RSVP would help the planning.\n\n` +
    `RSVP: ${rsvpUrl}\n\n` +
    `This is the only reminder we'll send.`;

  return { subject, html, text };
}
