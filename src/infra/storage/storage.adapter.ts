/**
 * StorageAdapter — pluggable backend for binary uploads (logos, cover images,
 * etc). Two drivers ship today:
 *
 *   - `local`  (dev) — writes to ./storage/uploads/<key>, served by Express
 *     static at <API_ORIGIN>/uploads/*. Zero credentials, fastest to iterate on.
 *   - `s3`     (prod) — talks to any S3-compatible bucket (AWS S3, Cloudflare R2,
 *     Backblaze B2, Wasabi…). Returns URLs from a configured public base
 *     so the bucket can sit behind a CDN.
 *
 * Pick the driver via `STORAGE_DRIVER=local|s3` in api/.env. The interface
 * below is the only contract callers depend on — see brand endpoints in 5c·D2.
 */

export interface StorageUploadArgs {
  /**
   * Storage key — already includes any namespacing (e.g.
   * `events/<eventId>/logo-<uuid>.png`). The adapter does NOT munge this; the
   * caller owns the layout.
   */
  key: string;
  body: Buffer;
  contentType: string;
  /**
   * Cache-Control header to set on the stored object (S3 driver only; local
   * driver delegates caching to the static middleware). Defaults to 1y immutable
   * since brand assets are content-addressed.
   */
  cacheControl?: string;
}

export interface StorageUploadResult {
  /** Public URL where the asset can be fetched. */
  url: string;
  /** The key that was used (echoed back for convenience). */
  key: string;
}

export abstract class StorageAdapter {
  abstract upload(args: StorageUploadArgs): Promise<StorageUploadResult>;
  abstract delete(key: string): Promise<void>;
  /** Compose a public URL for a key without round-tripping to the backend. */
  abstract getPublicUrl(key: string): string;
}
