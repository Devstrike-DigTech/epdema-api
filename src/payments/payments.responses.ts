import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Swagger-only response classes for the payments controller. The runtime
 * serializer (`payments.serializer.ts`) returns plain objects whose inferred
 * shape matches these classes — we never instantiate them. Their sole job
 * is to give the OpenAPI spec a typed body schema so codegen produces real
 * types instead of `unknown`.
 *
 * Convention for the whole codebase: every controller exports a `*.responses.ts`
 * file alongside its `*.serializer.ts`. Update both when a serializer changes.
 */

export class PaymentDto {
  @ApiProperty({ format: 'uuid', example: '7a0a1b50-31c2-4d97-9d7e-1a5e0f0a2c4d' })
  id!: string;

  @ApiProperty({ format: 'uuid', example: '6bb69700-72eb-40a0-b37e-e6c0b8b004a9' })
  eventId!: string;

  @ApiProperty({
    example: 'tier',
    enum: ['tier', 'addon'],
    description: 'What the payment is for.',
  })
  purpose!: string;

  @ApiPropertyOptional({
    nullable: true,
    type: 'string',
    example: 'occasion',
    description: 'Slug of the tier or add-on this payment unlocks.',
  })
  purposeRef!: string | null;

  @ApiProperty({
    type: 'string',
    example: '3900000',
    description: 'Amount in kobo (NGN minor unit) as a string — BigInt-safe.',
  })
  amountMinor!: string;

  @ApiProperty({
    type: 'string',
    example: '292500',
    description: 'Nigerian VAT in kobo as a string — BigInt-safe.',
  })
  taxMinor!: string;

  @ApiProperty({ example: 'NGN' })
  currency!: string;

  @ApiProperty({
    example: 'paystack',
    enum: ['paystack', 'internal_free'],
  })
  processor!: string;

  @ApiPropertyOptional({
    nullable: true,
    type: 'string',
    example: 'ref_3f8c2e1a4b9d',
    description: 'Paystack reference (UUID) — null for the free-tier internal processor.',
  })
  processorReference!: string | null;

  @ApiProperty({
    example: 'pending',
    enum: ['pending', 'success', 'failed', 'refunded'],
  })
  status!: string;

  @ApiProperty({ example: '2026-05-26T08:12:00.000Z' })
  initiatedAt!: string;

  @ApiPropertyOptional({ nullable: true, type: 'string', example: '2026-05-26T08:14:23.000Z' })
  finalizedAt!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: 'string',
    example: null,
    description: 'Set when status=failed (e.g. "card_declined").',
  })
  failureReason!: string | null;
}

export class PaymentIntentResponseDto {
  @ApiProperty({ format: 'uuid', example: '7a0a1b50-31c2-4d97-9d7e-1a5e0f0a2c4d' })
  paymentId!: string;

  @ApiProperty({
    example: 'pending',
    enum: ['pending', 'success', 'failed'],
  })
  status!: 'success' | 'pending' | 'failed';

  @ApiPropertyOptional({
    nullable: true,
    type: 'string',
    example: 'https://checkout.paystack.com/abc123',
    description:
      'Paystack-hosted checkout URL. Null for free-tier (auto-success) or replays — ' +
      'the client should poll payment status instead of redirecting.',
  })
  authorizationUrl!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: 'string',
    example: 'ref_3f8c2e1a4b9d',
    description: 'Paystack reference — null for the free-tier internal processor.',
  })
  reference!: string | null;

  @ApiProperty({
    type: 'string',
    example: '3900000',
    description: 'Total amount in kobo as a string — BigInt-safe.',
  })
  amountMinor!: string;

  @ApiProperty({ example: 'NGN' })
  currency!: string;
}
