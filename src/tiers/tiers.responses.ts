import { ApiProperty } from '@nestjs/swagger';

/**
 * Swagger-only response classes for the tiers controller. The runtime
 * serializers (`serializers.ts`) return plain objects whose inferred
 * shape matches these classes — we never instantiate them. Their sole
 * job is to give the OpenAPI spec a typed body schema so codegen produces
 * real types instead of `unknown`.
 *
 * Convention for the whole codebase: every controller exports a `*.responses.ts`
 * file alongside its `*.serializer.ts`. Update both when a serializer changes.
 */

export class TierDto {
  @ApiProperty({
    example: 'occasion',
    enum: ['free', 'gathering', 'occasion', 'production', 'marquee'],
  })
  slug!: string;

  @ApiProperty({ example: 'Occasion' })
  displayName!: string;

  @ApiProperty({
    type: 'string',
    example: '3900000',
    description:
      'Price in kobo (NGN minor unit) as a string — amounts are BigInt server-side ' +
      'and JSON-serialized as strings so values above 2^53 stay precise.',
  })
  amountMinor!: string;

  @ApiProperty({ example: 'NGN' })
  currency!: string;

  @ApiProperty({ example: 10 })
  sortOrder!: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Default feature bag copied onto event.features at provisioning. ' +
      'Shape: { sharing: {...}, branding: {...}, invitees: {...}, … }.',
    example: {
      sharing: { emailReminders: true, customSlug: true },
      branding: { customSharePage: false },
      invitees: { maxInvitees: 200, customQuestions: 5 },
    },
  })
  featureTemplate!: Record<string, unknown>;
}

export class AddonDto {
  @ApiProperty({ example: 'anonymous_proposals' })
  slug!: string;

  @ApiProperty({ example: 'Anonymous Proposals' })
  displayName!: string;

  @ApiProperty({
    type: 'string',
    example: '500000',
    description: 'Price in kobo (NGN minor unit) as a string — BigInt-safe.',
  })
  amountMinor!: string;

  @ApiProperty({ example: 'NGN' })
  currency!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Patch deep-merged onto event.features when this add-on is purchased.',
    example: {
      sharing: { anonymousProposals: true },
    },
  })
  featurePatch!: Record<string, unknown>;
}
