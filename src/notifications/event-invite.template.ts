/**
 * "You're invited" email — sent to event invitees (people who attend),
 * NOT planning members (people who decide).
 * Single button: RSVP.
 */
import { renderEmailLayout, escapeHtml } from './_layout';

interface InviteEmailArgs {
  eventTitle: string;
  eventType: string;
  scheduledDateDisplay: string | null;
  organizerName: string;
  rsvpUrl: string;
  recipientName: string | null;
}

export function renderEventInviteEmail({
  eventTitle,
  eventType,
  scheduledDateDisplay,
  organizerName,
  rsvpUrl,
  recipientName,
}: InviteEmailArgs): { subject: string; html: string; text: string } {
  const subject = `You're invited: "${eventTitle}"`;
  const greeting = recipientName ? `Hi ${escapeHtml(recipientName)},` : 'Hi,';
  const preheader = `${organizerName} would love to know if you can make it${scheduledDateDisplay ? ` on ${scheduledDateDisplay}` : ''}.`;

  const contentHtml = `
    <p style="font-size:20px;line-height:1.4;margin:0 0 8px;color:#1F1230;font-family:'Source Serif 4',Georgia,serif;" class="epd-ink">"${escapeHtml(eventTitle)}"</p>
    ${scheduledDateDisplay ? `<p style="font-size:14px;color:#877A91;margin:0 0 24px;" class="epd-soft">${escapeHtml(scheduledDateDisplay)}</p>` : '<div style="height:8px"></div>'}
    <p style="font-size:15px;line-height:1.6;color:#4A3D5B;margin:0 0 8px;" class="epd-ink">
      ${greeting} ${escapeHtml(organizerName)} would love to know if you can make it.
      Tap below to RSVP — yes, no, or maybe.
    </p>`;

  const html = renderEmailLayout({
    eyebrow: `EPDEMA · ${eventType}`,
    heading: "You're invited.",
    preheader,
    contentHtml,
    cta: { label: 'RSVP', url: rsvpUrl },
    ctaFootnote: 'Or paste this link into your browser:',
    belowFooterNote:
      "You can change your answer at any time using the same link. If you weren't expecting this email, ignore it — your details aren't shared further.",
  });

  const text =
    `${greeting} ${organizerName} invited you to ${eventTitle}${scheduledDateDisplay ? ` (${scheduledDateDisplay})` : ''}.\n\n` +
    `RSVP: ${rsvpUrl}\n\n` +
    `You can change your answer any time using the same link.`;

  return { subject, html, text };
}
