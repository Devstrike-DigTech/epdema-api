import {
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { ApiExcludeController, ApiExcludeEndpoint } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { PaymentsService } from './payments.service';
import { PaystackAdapter } from './paystack.adapter';

/**
 * Paystack webhook receiver.
 *
 * Mounted at /api/webhooks/paystack. Raw body is required for signature
 * verification — registered via `rawBody: true` on the request body in main.ts.
 *
 * Always returns 200 once the signature is verified, even if downstream
 * processing fails — Paystack retries on non-2xx and we want to avoid
 * unbounded retries while we investigate.
 */
@ApiExcludeController()
@Controller('webhooks')
export class PaystackWebhookController {
  private readonly logger = new Logger(PaystackWebhookController.name);

  constructor(
    private readonly paystack: PaystackAdapter,
    private readonly payments: PaymentsService,
  ) {}

  @Public()
  @Post('paystack')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async receive(
    @Req() req: Request,
    @Headers('x-paystack-signature') signature?: string,
  ) {
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!raw) {
      // Misconfiguration — rawBody parser not active for this route.
      this.logger.error('Paystack webhook hit but no rawBody on request');
      throw new ForbiddenException('Signature verification failed');
    }

    if (!this.paystack.verifyWebhookSignature(raw, signature)) {
      this.logger.warn(`Rejected webhook: bad signature from ${req.ip}`);
      throw new ForbiddenException('Signature verification failed');
    }

    let payload: { event?: string; data?: any };
    try {
      payload = JSON.parse(raw.toString('utf8')) as { event?: string; data?: any };
    } catch {
      this.logger.warn('Paystack webhook with unparseable JSON');
      return { received: true };
    }

    try {
      await this.payments.processWebhook(payload);
    } catch (err) {
      // Swallow — we always 200 to Paystack once signature is good.
      // Real ops would queue for retry; Phase 2 logs and moves on.
      this.logger.error(
        `processWebhook threw for event=${payload.event}`,
        err instanceof Error ? err.stack : String(err),
      );
    }

    return { received: true };
  }
}
