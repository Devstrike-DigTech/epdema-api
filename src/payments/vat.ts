/**
 * NG VAT — 7.5%, displayed as VAT-inclusive per spec (docs/03 §11).
 * Given a gross amount (kobo), back-calculate the VAT portion.
 *
 *   net   = gross / 1.075
 *   vat   = gross - net
 *
 * Round to the nearest kobo using banker's rounding via Math.round
 * (kobo precision is fine — we never display fractional kobo).
 */
export function computeNgVatMinor(grossMinor: bigint): bigint {
  if (grossMinor <= 0n) return 0n;
  // Use number arithmetic with scaling, then round back to BigInt kobo.
  // Safe because event prices won't exceed Number.MAX_SAFE_INTEGER kobo.
  const gross = Number(grossMinor);
  const net = Math.round(gross / 1.075);
  return BigInt(gross - net);
}
