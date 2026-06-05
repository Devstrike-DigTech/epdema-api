import { Resend } from 'resend';
import { renderEmailLayout } from './_layout';

/**
 * Password-reset email — fired by Better Auth's
 * `emailAndPassword.sendResetPassword` hook when a user POSTs to
 * `/api/auth/request-password-reset`. Same self-contained-sender pattern as
 * `verify-email.template.ts`.
 */
interface ResetPasswordArgs {
  email: string;
  resetUrl: string;
}

export async function sendPasswordResetEmail({ email, resetUrl }: ResetPasswordArgs): Promise<void> {
  const key = process.env.RESEND_API_KEY ?? '';
  const from = process.env.EMAIL_FROM ?? 'EPDEMA <onboarding@resend.dev>';
  const { subject, html, text } = render(resetUrl);

  if (!key.startsWith('re_')) {
    // eslint-disable-next-line no-console
    console.log(`[password-reset dev] → ${email}\n  ${resetUrl}`);
    return;
  }
  const resend = new Resend(key);
  const { error } = await resend.emails.send({ from, to: email, subject, html, text });
  if (error) throw new Error(`Password-reset send failed: ${error.message}`);
}

function render(resetUrl: string): { subject: string; html: string; text: string } {
  const subject = 'Reset your password — EPDEMA';
  const preheader = 'Use the link inside to choose a new password. Expires in 1 hour.';

  const contentHtml = `
    <p style="font-size:15px;line-height:1.55;color:#4A3D5B;margin:0 0 8px;" class="epd-ink">
      Someone asked to reset the password on your EPDEMA account. If that was you,
      click the button below to choose a new one. The link expires in 1 hour.
    </p>`;

  const html = renderEmailLayout({
    eyebrow: 'EPDEMA · Password reset',
    heading: 'Reset your password',
    preheader,
    contentHtml,
    cta: { label: 'Reset password', url: resetUrl },
    ctaFootnote: "If the button doesn't work, paste this link into your browser:",
    belowFooterNote:
      "Didn't ask to reset? You can safely ignore this email — your password stays unchanged. If you keep getting these and didn't request them, change your password from the account settings as a precaution.",
  });

  const text = `We got a request to reset the password on your EPDEMA account.\n\nClick this link to choose a new one:\n\n${resetUrl}\n\nThe link expires in 1 hour. If you didn't request a reset, you can safely ignore this message — your password stays unchanged.\n\n— EPDEMA`;

  return { subject, html, text };
}
