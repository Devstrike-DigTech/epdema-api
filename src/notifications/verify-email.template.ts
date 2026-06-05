import { Resend } from 'resend';
import { renderEmailLayout } from './_layout';

/**
 * Welcome / verify-email message — sent by Better Auth's
 * `emailVerification.sendVerificationEmail` hook on sign-up and again
 * when the user clicks "Resend verification".
 *
 * Self-contained sender (own Resend client) rather than going through
 * NotificationsModule because Better Auth lives outside the NestJS DI
 * container (see `better-auth.config.ts`). When `RESEND_API_KEY` is
 * the dev placeholder, fall through to console — matches `ResendAdapter`.
 */
interface VerifyEmailArgs {
  email: string;
  verificationUrl: string;
}

export async function sendVerificationEmail({ email, verificationUrl }: VerifyEmailArgs): Promise<void> {
  const key = process.env.RESEND_API_KEY ?? '';
  const from = process.env.EMAIL_FROM ?? 'EPDEMA <onboarding@resend.dev>';
  const { subject, html, text } = render(verificationUrl);

  if (!key.startsWith('re_')) {
    // eslint-disable-next-line no-console
    console.log(`[verify-email dev] → ${email}\n  ${verificationUrl}`);
    return;
  }
  const resend = new Resend(key);
  const { error } = await resend.emails.send({ from, to: email, subject, html, text });
  if (error) throw new Error(`Verify-email send failed: ${error.message}`);
}

function render(verificationUrl: string): { subject: string; html: string; text: string } {
  const subject = 'Confirm your email — EPDEMA';
  const preheader = 'Click the link inside to finish setting up your EPDEMA account. Expires in 24 hours.';

  const contentHtml = `
    <p style="font-size:15px;line-height:1.55;color:#4A3D5B;margin:0 0 8px;" class="epd-ink">
      Click the button below to confirm your email and finish setting up your EPDEMA account.
      The link expires in 24 hours.
    </p>`;

  const html = renderEmailLayout({
    eyebrow: 'EPDEMA · Welcome',
    heading: 'Confirm your email',
    preheader,
    contentHtml,
    cta: { label: 'Confirm email', url: verificationUrl },
    ctaFootnote: "If the button doesn't work, paste this link into your browser:",
    belowFooterNote:
      "Didn't sign up? You can safely ignore this email — no account will be created without verification.",
  });

  const text = `Welcome to EPDEMA!\n\nClick this link to confirm your email and finish setting up your account:\n\n${verificationUrl}\n\nThe link expires in 24 hours. If you didn't sign up, you can safely ignore this message.\n\n— EPDEMA`;

  return { subject, html, text };
}
