/**
 * Inline email HTML templates. Match the Convergence palette so the inbox
 * experience looks like the product. Phase 10 hardening can swap these for
 * MJML or React Email if we need richer layouts.
 */

interface InvitationEmailArgs {
  eventTitle: string;
  eventType: string;
  inviterName: string;
  acceptUrl: string;
}

export function renderInvitationEmail({
  eventTitle,
  eventType,
  inviterName,
  acceptUrl,
}: InvitationEmailArgs): { subject: string; html: string; text: string } {
  const subject = `${inviterName} invited you to plan "${eventTitle}" on EPDEMA`;

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:40px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;background:#FAF7F2;color:#1F1230;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #E5DED1;border-radius:8px;padding:32px;">
      <p style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#E8A93D;font-weight:600;margin:0 0 16px;">EPDEMA · Planning invitation</p>
      <h1 style="font-size:24px;font-weight:700;line-height:1.25;margin:0 0 16px;color:#1F1230;">You're invited to help plan</h1>
      <p style="font-size:18px;line-height:1.4;margin:0 0 8px;color:#1F1230;font-family:'Source Serif 4',Georgia,serif;">"${escapeHtml(eventTitle)}"</p>
      <p style="font-size:14px;color:#877A91;margin:0 0 24px;">${escapeHtml(eventType)} · invited by ${escapeHtml(inviterName)}</p>
      <p style="font-size:15px;line-height:1.6;color:#4A3D5B;margin:0 0 24px;">
        EPDEMA turns group disagreement into one agreed plan, one decision at a time.
        Click below to join the planning room and start proposing alternatives.
      </p>
      <a href="${acceptUrl}" style="display:inline-block;background:#E8A93D;color:#1F1230;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:15px;">Accept invitation</a>
      <p style="font-size:12px;color:#877A91;margin:32px 0 0;line-height:1.5;">
        Or paste this link into your browser:<br>
        <span style="color:#8A5A0F;word-break:break-all;">${acceptUrl}</span>
      </p>
      <hr style="border:none;border-top:1px solid #E5DED1;margin:24px 0;">
      <p style="font-size:11px;color:#877A91;margin:0;line-height:1.5;">
        This invitation expires in 7 days. If you weren't expecting this email, you can safely ignore it.
      </p>
    </div>
  </body>
</html>`;

  const text =
    `${inviterName} invited you to plan "${eventTitle}" (${eventType}) on EPDEMA.\n\n` +
    `Accept here: ${acceptUrl}\n\n` +
    `This invitation expires in 7 days.`;

  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
