import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';

/**
 * Thin Paystack client. Wraps the two endpoints we need at MVP plus signature
 * verification. Behind an adapter interface so we can swap or add Flutterwave
 * later without touching business logic.
 *
 * Docs: https://paystack.com/docs/api/
 */

export interface PaystackInitParams {
  /** Amount in kobo (NGN minor unit). Paystack expects integer kobo. */
  amount: number;
  email: string;
  /** Server-generated UUID; used for idempotency on Paystack's side too. */
  reference: string;
  /** Browser redirect target after Paystack hosted checkout completes. */
  callbackUrl: string;
  /** Arbitrary JSON returned in the webhook payload — embed event_id, payment_id. */
  metadata?: Record<string, unknown>;
  /** Optional channel restriction: ['card','bank','ussd','bank_transfer','mobile_money','qr','apple_pay'] */
  channels?: string[];
}

export interface PaystackInitResult {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

export interface PaystackVerifyResult {
  status: 'success' | 'failed' | 'pending' | 'abandoned' | 'reversed' | string;
  reference: string;
  /** Kobo. */
  amount: number;
  currency: string;
  paidAt: string | null;
  channel: string | null;
  raw: unknown;
}

@Injectable()
export class PaystackAdapter {
  private readonly logger = new Logger(PaystackAdapter.name);
  private readonly baseUrl = 'https://api.paystack.co';
  private readonly secretKey: string;

  constructor(config: ConfigService) {
    this.secretKey = config.getOrThrow<string>('PAYSTACK_SECRET_KEY');
  }

  /**
   * Initialize a transaction. Returns the URL to redirect the browser to.
   * Reference is whatever we pass in — we own the ID space.
   */
  async initialize(params: PaystackInitParams): Promise<PaystackInitResult> {
    const res = await this.request('/transaction/initialize', 'POST', {
      amount: params.amount,
      email: params.email,
      reference: params.reference,
      callback_url: params.callbackUrl,
      metadata: params.metadata,
      ...(params.channels && { channels: params.channels }),
    });

    if (!res?.status || !res?.data?.authorization_url) {
      throw new ServiceUnavailableException(
        `Paystack initialize failed: ${res?.message ?? 'no authorization_url returned'}`,
      );
    }

    return {
      authorizationUrl: res.data.authorization_url,
      accessCode: res.data.access_code,
      reference: res.data.reference,
    };
  }

  /**
   * Server-side verify. Use as a fallback when the webhook hasn't arrived
   * yet (return-page polling) or as periodic reconciliation.
   */
  async verify(reference: string): Promise<PaystackVerifyResult> {
    const res = await this.request(
      `/transaction/verify/${encodeURIComponent(reference)}`,
      'GET',
    );

    if (!res?.status || !res?.data) {
      throw new ServiceUnavailableException(`Paystack verify failed: ${res?.message ?? 'unknown'}`);
    }
    const d = res.data;
    return {
      status: d.status,
      reference: d.reference,
      amount: d.amount,
      currency: d.currency,
      paidAt: d.paid_at ?? d.paidAt ?? null,
      channel: d.channel ?? null,
      raw: d,
    };
  }

  /**
   * Verifies the `x-paystack-signature` header against the raw request body.
   * HMAC-SHA512 of body using the secret key.
   */
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    if (!signatureHeader) return false;
    const expected = crypto
      .createHmac('sha512', this.secretKey)
      .update(rawBody)
      .digest('hex');
    const sigBuf = Buffer.from(signatureHeader, 'utf8');
    const expBuf = Buffer.from(expected, 'utf8');
    if (sigBuf.length !== expBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expBuf);
  }

  private async request(
    path: string,
    method: 'GET' | 'POST',
    body?: Record<string, unknown>,
  ): Promise<{ status?: boolean; message?: string; data?: any }> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
      const json = (await res.json()) as { status?: boolean; message?: string; data?: any };
      if (!res.ok) {
        this.logger.warn(`Paystack ${method} ${path} → ${res.status}: ${json?.message ?? 'no message'}`);
      }
      return json;
    } catch (err) {
      this.logger.error(`Paystack ${method} ${path} threw`, err instanceof Error ? err.stack : String(err));
      throw new ServiceUnavailableException('Payment processor unreachable');
    }
  }
}
