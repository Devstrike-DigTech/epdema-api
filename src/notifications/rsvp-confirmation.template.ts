/**
 * Confirmation email after an invitee submits an RSVP. Short + friendly.
 * Same link is reusable so they can change their mind later.
 */
import { renderEmailLayout, escapeHtml } from './_layout';

interface RsvpConfirmationArgs {
  eventTitle: string;
  scheduledDateDisplay: string | null;
  status: 'yes' | 'no' | 'maybe';
  rsvpUrl: string;
  shareUrl: string | null;
  recipientName: string | null;
}

const STATUS_LINE: Record<'yes' | 'no' | 'maybe', string> = {
  yes: "You're in. See you there.",
  no: "Thanks for letting them know — your spot is freed up.",
  maybe: "Got it — we'll mark you as undecided. You can update any time.",
};

export function renderRsvpConfirmationEmail({
  eventTitle,
  scheduledDateDisplay,
  status,
  rsvpUrl,
  shareUrl,
  recipientName,
}: RsvpConfirmationArgs): { subject: string; html: string; text: string } {
  const subject = `RSVP recorded: "${eventTitle}"`;
  const greeting = recipientName ? `Hi ${escapeHtml(recipientName)},` : 'Hi,';
  const preheader = `Recorded as ${status.toUpperCase()} for "${eventTitle}". Update any time.`;

  const contentHtml = `
    <p style="font-size:18px;line-height:1.4;margin:0 0 4px;color:#1F1230;font-family:'Source Serif 4',Georgia,serif;" class="epd-ink">"${escapeHtml(eventTitle)}"</p>
    ${scheduledDateDisplay ? `<p style="font-size:14px;color:#877A91;margin:0 0 24px;" class="epd-soft">${escapeHtml(scheduledDateDisplay)}</p>` : '<div style="height:8px"></div>'}
    <p style="font-size:15px;line-height:1.6;color:#4A3D5B;margin:0 0 24px;" class="epd-ink">
      ${greeting} we've saved your answer as <strong>${status.toUpperCase()}</strong>.
      Plans change — feel free to update any time using the same link.
    </p>
    <p style="margin:0 0 0;">
      <a href="${rsvpUrl}" style="display:inline-block;background:#F2EDE3;color:#1F1230;font-weight:600;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;">Update your answer</a>
    </p>
    ${shareUrl ? `<p style="font-size:12px;color:#877A91;margin:24px 0 0;line-height:1.5;" class="epd-soft">View the full plan: <a href="${shareUrl}" style="color:#4A2B7E;">${shareUrl}</a></p>` : ''}`;

  const html = renderEmailLayout({
    eyebrow: 'EPDEMA · RSVP recorded',
    heading: STATUS_LINE[status],
    preheader,
    contentHtml,
  });

  const text =
    `${greeting} we've recorded your RSVP as ${status.toUpperCase()} for "${eventTitle}".\n\n` +
    `Update any time: ${rsvpUrl}` +
    (shareUrl ? `\n\nFull plan: ${shareUrl}` : '');

  return { subject, html, text };
}
