import { StorageAdapter } from '../infra/storage/storage.adapter';

/**
 * Persisted brand shape (matches what's stored in event.brand JSON).
 */
export interface BrandStored {
  color?: string | null;
  accentColor?: string | null;
  textColor?: string | null;
  logoKey?: string | null;
  coverImageKey?: string | null;
}

/**
 * API-facing brand shape. Includes hydrated public URLs so clients don't need
 * to know anything about the storage layer.
 */
export interface BrandDto {
  color: string | null;
  accentColor: string | null;
  textColor: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
}

const EMPTY: BrandStored = {};

export function serializeBrand(
  raw: unknown,
  storage: StorageAdapter,
): BrandDto {
  const b = (raw ?? EMPTY) as BrandStored;
  return {
    color: b.color ?? null,
    accentColor: b.accentColor ?? null,
    textColor: b.textColor ?? null,
    logoUrl: b.logoKey ? storage.getPublicUrl(b.logoKey) : null,
    coverImageUrl: b.coverImageKey ? storage.getPublicUrl(b.coverImageKey) : null,
  };
}

/**
 * Returns the stored shape (with keys, not URLs) — used internally when
 * computing the next persisted state without hitting the storage adapter.
 */
export function readBrand(raw: unknown): BrandStored {
  return (raw ?? EMPTY) as BrandStored;
}
