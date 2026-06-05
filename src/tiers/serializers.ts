import type { Tier, Addon } from '@prisma/client';

/**
 * BigInt → string for JSON safety. JS numbers can't represent kobo precisely
 * past 2^53; clients should treat amount fields as strings and use BigInt or
 * a money library to do math.
 */

export function serializeTier(tier: Tier) {
  return {
    slug: tier.slug,
    displayName: tier.displayName,
    amountMinor: tier.amountMinor.toString(),
    currency: tier.currency,
    sortOrder: tier.sortOrder,
    featureTemplate: tier.featureTemplate,
  };
}

export function serializeAddon(addon: Addon) {
  return {
    slug: addon.slug,
    displayName: addon.displayName,
    amountMinor: addon.amountMinor.toString(),
    currency: addon.currency,
    featurePatch: addon.featurePatch,
  };
}
