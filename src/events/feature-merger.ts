/**
 * Derives the final `event.features` JSON from a tier's featureTemplate and
 * a list of add-on featurePatches.
 *
 * Merge rules:
 *  - Deep merge plain objects.
 *  - For numeric fields ending in "Add" (e.g. `quotaAdd`), strip the suffix
 *    and ADD the value to the existing field. Lets vendor-shortlist add-ons
 *    stack onto tier quota without overwriting.
 *  - Booleans and primitives: addon wins.
 *  - Arrays: addon wins (no concat; we'd need explicit semantics).
 *
 * Pure, no side effects. Easy to test.
 */
export function mergeFeatures(
  tierTemplate: unknown,
  addonPatches: unknown[],
): Record<string, unknown> {
  let merged = deepClone(toObject(tierTemplate));
  for (const patch of addonPatches) {
    merged = applyPatch(merged, toObject(patch));
  }
  return merged;
}

function applyPatch(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  for (const [key, value] of Object.entries(patch)) {
    // numeric stacking: foo.quotaAdd: 20 → target.foo.quota += 20
    if (key.endsWith('Add') && typeof value === 'number') {
      const baseKey = key.slice(0, -'Add'.length);
      const existing = target[baseKey];
      target[baseKey] = (typeof existing === 'number' ? existing : 0) + value;
      continue;
    }
    if (isPlainObject(value) && isPlainObject(target[key])) {
      target[key] = applyPatch(target[key] as Record<string, unknown>, value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

function toObject(v: unknown): Record<string, unknown> {
  return isPlainObject(v) ? (v as Record<string, unknown>) : {};
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
