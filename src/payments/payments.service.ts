import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../infra/audit/audit.service';
import { EventsService } from '../events/events.service';
import { TiersService } from '../tiers/tiers.service';
import { SegmentsService } from '../segments/segments.service';
import { MembersService } from '../members/members.service';
import { mergeFeatures } from '../events/feature-merger';
import { PaystackAdapter } from './paystack.adapter';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { computeNgVatMinor } from './vat';

const PROVISIONABLE_STATES = new Set(['draft', 'payment_pending']);

export interface CreateIntentResult {
  paymentId: string;
  status: 'success' | 'pending' | 'failed';
  /** Present when paystack flow needed; null for free tier or already-success. */
  authorizationUrl: string | null;
  reference: string | null;
  amountMinor: string;
  currency: string;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly webOrigin: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tiers: TiersService,
    private readonly events: EventsService,
    private readonly segments: SegmentsService,
    private readonly members: MembersService,
    private readonly paystack: PaystackAdapter,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.webOrigin = config.getOrThrow<string>('WEB_ORIGIN');
  }

  // ────────────────────────────────────────────────────────────
  // Intent creation
  // ────────────────────────────────────────────────────────────

  async createIntent(
    userId: string,
    userEmail: string,
    idempotencyKey: string,
    dto: CreatePaymentIntentDto,
  ): Promise<CreateIntentResult> {
    if (!idempotencyKey || idempotencyKey.length < 8) {
      throw new BadRequestException('Idempotency-Key header required (UUID v4 recommended).');
    }

    // Replay: if we've seen this idempotency key before, return the existing record.
    const existing = await this.prisma.payment.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      // Don't leak: confirm it belongs to this user before returning.
      if (existing.userId !== userId) {
        throw new ConflictException('Idempotency key collision');
      }
      return this.materializeIntentResult(existing);
    }

    // Ownership + state guard.
    const event = await this.events.getOwnedOrThrow(userId, dto.eventId);
    if (!PROVISIONABLE_STATES.has(event.state)) {
      throw new ConflictException(`Event is already in state '${event.state}'; cannot start a new payment.`);
    }

    // Server-side amount derivation. Never trust the client.
    const tier = await this.tiers.getTierOrThrow(dto.tierSlug);
    const addonSlugs = dto.addonSlugs ?? [];
    const addons = await this.tiers.getAddonsOrThrow(addonSlugs);

    const tierMinor = tier.amountMinor;
    const addonsMinor = addons.reduce((sum, a) => sum + a.amountMinor, 0n);
    const totalMinor = tierMinor + addonsMinor;
    const taxMinor = computeNgVatMinor(totalMinor);

    // Free tier (and free add-ons summing to zero) short-circuit Paystack entirely.
    if (totalMinor === 0n) {
      const payment = await this.prisma.$transaction(async (tx) => {
        const created = await tx.payment.create({
          data: {
            eventId: event.id,
            userId,
            purpose: 'tier',
            purposeRef: tier.slug,
            amountMinor: 0n,
            taxMinor: 0n,
            currency: tier.currency,
            processor: 'internal_free',
            processorReference: null,
            status: 'success',
            idempotencyKey,
            initiatedAt: new Date(),
            finalizedAt: new Date(),
          },
        });
        await this.provisionEvent(tx, event.id, tier, addons, created.id, userId);
        return created;
      });

      return this.materializeIntentResult(payment);
    }

    // Paid tier → create pending payment, mark event payment_pending, init Paystack.
    const callbackUrl =
      dto.callbackUrl ?? `${this.webOrigin}/events/${event.id}/return`;

    // Pre-generate the reference (UUID) so we can persist it before talking to Paystack.
    const reference = crypto.randomUUID();

    const pending = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          eventId: event.id,
          userId,
          purpose: 'tier',
          purposeRef: tier.slug,
          amountMinor: totalMinor,
          taxMinor,
          currency: tier.currency,
          processor: 'paystack',
          processorReference: reference,
          status: 'pending',
          idempotencyKey,
        },
      });
      await tx.event.update({
        where: { id: event.id },
        data: { state: 'payment_pending', tierSlug: tier.slug },
      });
      // Stage the chosen add-ons so the webhook handler knows what was bought
      // even if the client never returns to confirm.
      for (const addon of addons) {
        await tx.eventAddon.upsert({
          where: { eventId_addonSlug: { eventId: event.id, addonSlug: addon.slug } },
          create: { eventId: event.id, addonSlug: addon.slug, paymentId: created.id },
          update: { paymentId: created.id },
        });
      }
      return created;
    });

    await this.audit.record({
      action: 'payment.intent_created',
      actorUserId: userId,
      eventId: event.id,
      details: {
        paymentId: pending.id,
        tierSlug: tier.slug,
        addonSlugs,
        amountMinor: totalMinor.toString(),
        taxMinor: taxMinor.toString(),
      },
    });

    // Talk to Paystack outside the DB transaction so a slow processor doesn't
    // hold a Postgres connection. If init fails, mark payment failed.
    try {
      const init = await this.paystack.initialize({
        amount: Number(totalMinor),
        email: userEmail,
        reference,
        callbackUrl,
        metadata: {
          payment_id: pending.id,
          event_id: event.id,
          user_id: userId,
        },
      });

      return {
        paymentId: pending.id,
        status: 'pending',
        authorizationUrl: init.authorizationUrl,
        reference: init.reference,
        amountMinor: totalMinor.toString(),
        currency: tier.currency,
      };
    } catch (err) {
      await this.prisma.payment.update({
        where: { id: pending.id },
        data: {
          status: 'failed',
          finalizedAt: new Date(),
          failureReason: err instanceof Error ? err.message : 'paystack init failed',
        },
      });
      // Roll back event state so the user can retry from the wizard.
      await this.prisma.event.update({
        where: { id: event.id },
        data: { state: 'draft' },
      });
      throw err;
    }
  }

  // ────────────────────────────────────────────────────────────
  // Read / poll
  // ────────────────────────────────────────────────────────────

  /**
   * Look up a payment by the Paystack reference, optionally reconciling.
   * Used by the return page (Paystack only echoes `?reference=` in the redirect).
   */
  async getOwnedByReference(userId: string, reference: string, { reconcile = false } = {}) {
    const payment = await this.prisma.payment.findUnique({
      where: { processorReference: reference },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.userId !== userId) throw new NotFoundException('Payment not found');
    return this.getOwned(userId, payment.id, { reconcile });
  }

  /**
   * Get a payment by id with optional Paystack reconciliation.
   * If the payment is still `pending` AND has a processor reference AND the
   * client says it just returned from Paystack, hit Paystack's verify endpoint
   * so we can promote success before the webhook arrives.
   */
  async getOwned(userId: string, paymentId: string, { reconcile = false } = {}) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.userId !== userId) throw new NotFoundException('Payment not found');

    if (reconcile && payment.status === 'pending' && payment.processorReference && payment.processor === 'paystack') {
      try {
        const verify = await this.paystack.verify(payment.processorReference);
        if (verify.status === 'success') {
          await this.applyChargeSuccess(payment.id, verify.raw);
        } else if (verify.status === 'failed' || verify.status === 'abandoned') {
          await this.applyChargeFailure(payment.id, verify.status, verify.raw);
        }
        return this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      } catch (err) {
        // If verify fails, leave as pending — the webhook is the authoritative source.
        this.logger.warn(`Reconcile-verify failed for ${payment.id}: ${err instanceof Error ? err.message : err}`);
      }
    }

    return payment;
  }

  // ────────────────────────────────────────────────────────────
  // Webhook entry point
  // ────────────────────────────────────────────────────────────

  /**
   * Process a Paystack webhook event. Signature must already be verified
   * by the controller. Idempotent: re-processing the same event is a no-op
   * once the payment is in a terminal state.
   */
  async processWebhook(payload: { event?: string; data?: any }): Promise<void> {
    const event = payload?.event;
    const data = payload?.data;
    if (!event || !data?.reference) {
      this.logger.warn(`Malformed webhook: ${JSON.stringify(payload).slice(0, 200)}`);
      return;
    }

    const payment = await this.prisma.payment.findUnique({
      where: { processorReference: data.reference },
    });
    if (!payment) {
      this.logger.warn(`Webhook for unknown reference: ${data.reference}`);
      return;
    }
    if (payment.status !== 'pending') {
      this.logger.log(`Webhook for already-finalized payment ${payment.id} (status=${payment.status}); ignoring`);
      return;
    }

    switch (event) {
      case 'charge.success':
        await this.applyChargeSuccess(payment.id, data);
        break;
      case 'charge.failed':
        await this.applyChargeFailure(payment.id, 'failed', data);
        break;
      default:
        this.logger.log(`Webhook event '${event}' for payment ${payment.id}; no-op`);
    }
  }

  // ────────────────────────────────────────────────────────────
  // Internal transitions
  // ────────────────────────────────────────────────────────────

  private async applyChargeSuccess(paymentId: string, rawPayload: unknown): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!payment || payment.status !== 'pending') return;

      // Defensive currency / amount sanity check.
      const raw = rawPayload as { amount?: number; currency?: string };
      if (raw?.currency && raw.currency !== payment.currency) {
        this.logger.error(
          `Currency mismatch on payment ${paymentId}: db=${payment.currency} processor=${raw.currency}`,
        );
        // Mark as failed rather than provision the wrong tier.
        await tx.payment.update({
          where: { id: paymentId },
          data: { status: 'failed', failureReason: 'currency_mismatch', finalizedAt: new Date(), rawPayload: rawPayload as Prisma.InputJsonValue },
        });
        return;
      }

      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: 'success',
          finalizedAt: new Date(),
          rawPayload: rawPayload as Prisma.InputJsonValue,
        },
      });

      const event = await tx.event.findUniqueOrThrow({ where: { id: payment.eventId } });
      if (!PROVISIONABLE_STATES.has(event.state)) {
        // Already provisioned by another path; nothing more to do.
        return;
      }
      if (!event.tierSlug) {
        this.logger.error(`Event ${event.id} has no tierSlug at webhook time`);
        return;
      }
      const tier = await tx.tier.findUniqueOrThrow({ where: { slug: event.tierSlug } });
      const eventAddons = await tx.eventAddon.findMany({
        where: { eventId: event.id, paymentId: payment.id },
        include: { addon: true },
      });
      await this.provisionEvent(
        tx,
        event.id,
        tier,
        eventAddons.map((ea) => ea.addon),
        payment.id,
        payment.userId,
      );
    }, { isolationLevel: 'Serializable' });

    await this.audit.record({
      action: 'payment.success',
      eventId: (await this.prisma.payment.findUnique({ where: { id: paymentId } }))?.eventId,
      details: { paymentId },
    });
  }

  private async applyChargeFailure(
    paymentId: string,
    reason: string,
    rawPayload: unknown,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!payment || payment.status !== 'pending') return;

      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: 'failed',
          failureReason: reason,
          finalizedAt: new Date(),
          rawPayload: rawPayload as Prisma.InputJsonValue,
        },
      });
      // Return event to draft so user can retry from the wizard.
      await tx.event.update({
        where: { id: payment.eventId },
        data: { state: 'draft' },
      });
    });

    await this.audit.record({
      action: 'payment.failed',
      eventId: (await this.prisma.payment.findUnique({ where: { id: paymentId } }))?.eventId,
      details: { paymentId, reason },
    });
  }

  /**
   * Provision the event: copy tier.featureTemplate + addon featurePatches into
   * event.features and flip state to 'provisioned'. Called inside an outer
   * transaction (`tx`) so the payment + event update are atomic.
   */
  private async provisionEvent(
    tx: Prisma.TransactionClient,
    eventId: string,
    tier: { slug: string; featureTemplate: Prisma.JsonValue },
    addons: { slug: string; featurePatch: Prisma.JsonValue }[],
    paymentId: string,
    userId: string,
  ): Promise<void> {
    const features = mergeFeatures(
      tier.featureTemplate,
      addons.map((a) => a.featurePatch),
    );

    const event = await tx.event.update({
      where: { id: eventId },
      data: {
        state: 'provisioned',
        tierSlug: tier.slug,
        features: features as Prisma.InputJsonValue,
        provisionedAt: new Date(),
      },
    });

    // Auto-create the default segment set, scoped to the event type + tier cap.
    // Same txn — segments arrive atomically with provisioning so the room is
    // immediately usable when the user lands on the event detail.
    await this.segments.createDefaultsForEvent(tx, {
      eventId: event.id,
      eventType: event.eventType,
      features,
    });

    // Auto-add the creator as the first admin planning member so they can
    // immediately deliberate. Idempotent.
    await this.members.ensureCreatorMembership(
      tx as unknown as { planningMember: { upsert: (args: unknown) => Promise<unknown> } },
      event.id,
      userId,
    );

    // Audit inside the txn so it's atomic with state change.
    await tx.auditLog.create({
      data: {
        action: 'event.provisioned',
        actorUserId: userId,
        eventId,
        details: {
          paymentId,
          tierSlug: tier.slug,
          addonSlugs: addons.map((a) => a.slug),
        } as Prisma.InputJsonValue,
      },
    });
  }

  private materializeIntentResult(payment: {
    id: string;
    status: string;
    processorReference: string | null;
    amountMinor: bigint;
    currency: string;
  }): CreateIntentResult {
    return {
      paymentId: payment.id,
      status: payment.status as 'success' | 'pending' | 'failed',
      authorizationUrl: null, // Replays don't re-derive the URL; client should poll status.
      reference: payment.processorReference,
      amountMinor: payment.amountMinor.toString(),
      currency: payment.currency,
    };
  }
}
