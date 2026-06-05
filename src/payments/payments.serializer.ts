import type { Payment } from '@prisma/client';

export function serializePayment(payment: Payment) {
  return {
    id: payment.id,
    eventId: payment.eventId,
    purpose: payment.purpose,
    purposeRef: payment.purposeRef,
    amountMinor: payment.amountMinor.toString(),
    taxMinor: payment.taxMinor.toString(),
    currency: payment.currency,
    processor: payment.processor,
    processorReference: payment.processorReference,
    status: payment.status,
    initiatedAt: payment.initiatedAt.toISOString(),
    finalizedAt: payment.finalizedAt?.toISOString() ?? null,
    failureReason: payment.failureReason,
  };
}
