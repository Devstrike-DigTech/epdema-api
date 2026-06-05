import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Resend wrapper. In dev with the placeholder key, falls through to
 * console.log so you can still validate flows without hitting Resend at all.
 * Switch to a real `re_...` key in api/.env and recreate the container
 * (`docker compose up -d --force-recreate api`) to get real email delivery.
 */
@Injectable()
export class ResendAdapter {
  private readonly logger = new Logger(ResendAdapter.name);
  private readonly client: Resend | null;
  private readonly fromAddress: string;
  private readonly devFallback: boolean;

  constructor(config: ConfigService) {
    const key = config.get<string>('RESEND_API_KEY') ?? '';
    this.fromAddress = config.get<string>('EMAIL_FROM') ?? 'EPDEMA <onboarding@resend.dev>';
    this.devFallback = !key.startsWith('re_');

    if (this.devFallback) {
      this.logger.warn(
        'RESEND_API_KEY is missing or placeholder — emails will be logged to console, not sent. Set a real key starting with `re_` and recreate the container to enable delivery.',
      );
      this.client = null;
    } else {
      this.client = new Resend(key);
    }
  }

  async send({ to, subject, html, text }: SendEmailArgs): Promise<void> {
    if (this.devFallback || !this.client) {
      // eslint-disable-next-line no-console
      console.log(
        `[email dev] → ${to}\n  Subject: ${subject}\n  HTML: ${html.replace(/\s+/g, ' ').slice(0, 200)}…`,
      );
      return;
    }
    try {
      const { error } = await this.client.emails.send({
        from: this.fromAddress,
        to,
        subject,
        html,
        ...(text && { text }),
      });
      if (error) {
        // Resend SDK returns errors in the response body rather than throwing.
        throw new Error(`Resend send failed: ${error.message}`);
      }
    } catch (err) {
      this.logger.error(
        `Email delivery failed to ${to} (subject: ${subject})`,
        err instanceof Error ? err.stack : String(err),
      );
      throw err;
    }
  }
}
