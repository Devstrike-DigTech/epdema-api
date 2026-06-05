/**
 * Email sent to all admins of an event when its final segment locks and
 * the publish-readiness check passes. Clear CTA back to the event detail.
 */
import { renderEmailLayout, escapeHtml } from './_layout';

interface PublishReadyEmailArgs {
  eventTitle: string;
  eventType: string;
  publishUrl: string;
  recipientName: string | null;
}

export function renderPublishReadyEmail({
  eventTitle,
  eventType,
  publishUrl,
  recipientName,
}: PublishReadyEmailArgs): { subject: string; html: string; text: string } {
  const subject = `Ready to publish: "${eventTitle}"`;
  const greeting = recipientName ? `Hi ${escapeHtml(recipientName)},` : 'Hi,';
  const preheader = `Every segment of "${eventTitle}" is decided. Time to publish.`;

  const contentHtml = `
    <p style="font-size:18px;line-height:1.4;margin:0 0 8px;color:#1F1230;font-family:'Source Serif 4',Georgia,serif;" class="epd-ink">"${escapeHtml(eventTitle)}"</p>
    <p style="font-size:14px;color:#877A91;margin:0 0 24px;" class="epd-soft">${escapeHtml(eventType)}</p>
    <p style="font-size:15px;line-height:1.6;color:#4A3D5B;margin:0 0 8px;" class="epd-ink">
      ${greeting} the planning room reached consensus on every segment.
      You can now publish the plan — that creates a public share link, unlocks calendar
      export, and lets you send the final invite to event attendees.
    </p>`;

  const html = renderEmailLayout({
    eyebrow: 'EPDEMA · Ready to publish',
    heading: 'Every segment is decided.',
    preheader,
    contentHtml,
    cta: { label: 'Publish the plan', url: publishUrl },
    ctaFootnote: 'Or paste this link into your browser:',
    belowFooterNote:
      "You're receiving this because you're an admin on this event. If a segment is unlocked later and the group re-deliberates, you may receive this email again.",
  });

  const text =
    `${recipientName ? `Hi ${recipientName},\n\n` : ''}` +
    `Every segment of "${eventTitle}" (${eventType}) is decided. ` +
    `You can publish the plan to create a public share link and unlock calendar export.\n\n` +
    `Publish: ${publishUrl}`;

  return { subject, html, text };
}
