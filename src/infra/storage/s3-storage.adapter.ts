import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import {
  StorageAdapter,
  StorageUploadArgs,
  StorageUploadResult,
} from './storage.adapter';

/**
 * S3-compatible storage driver. Works with AWS S3, Cloudflare R2, Backblaze B2,
 * Wasabi — anything that speaks the S3 PutObject/DeleteObject API. Public URLs
 * are composed from `STORAGE_S3_PUBLIC_BASE` so the bucket can sit behind a CDN
 * (e.g. https://cdn.epdema.com/<key> in front of R2).
 *
 * Required env:
 *   STORAGE_DRIVER=s3
 *   STORAGE_S3_BUCKET            e.g. epdema-uploads
 *   STORAGE_S3_REGION            e.g. auto (R2), us-east-1 (AWS)
 *   STORAGE_S3_ENDPOINT          omit for AWS; set for R2/B2/Wasabi
 *   STORAGE_S3_ACCESS_KEY_ID
 *   STORAGE_S3_SECRET_ACCESS_KEY
 *   STORAGE_S3_PUBLIC_BASE       e.g. https://cdn.epdema.com  (no trailing slash)
 */
/**
 * Lazy-init wrapper. Nest DI eagerly instantiates every provider in the module,
 * so the constructor itself must never throw — otherwise importing StorageModule
 * crashes the app whenever STORAGE_DRIVER=local (which is the default for dev).
 *
 * Real client setup + env validation are deferred to the first upload/delete
 * call. Misconfiguration surfaces as a clear runtime error at the call site
 * instead of bringing the whole app down at boot.
 */
@Injectable()
export class S3StorageAdapter extends StorageAdapter {
  private readonly logger = new Logger(S3StorageAdapter.name);
  private client: S3Client | null = null;
  private bucket = '';
  private publicBase = '';

  constructor(private readonly config: ConfigService) {
    super();
  }

  async upload(args: StorageUploadArgs): Promise<StorageUploadResult> {
    const { client, bucket } = this.ensureClient();
    const key = sanitizeKey(args.key);
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: args.body,
        ContentType: args.contentType,
        CacheControl: args.cacheControl ?? 'public, max-age=31536000, immutable',
      }),
    );
    return { url: this.getPublicUrl(key), key };
  }

  async delete(key: string): Promise<void> {
    const { client, bucket } = this.ensureClient();
    await client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: sanitizeKey(key) }),
    );
  }

  getPublicUrl(key: string): string {
    // Public URL is composable without a live client — but we still need the
    // env-driven base. Initialise lazily on first read too.
    if (!this.publicBase) {
      this.publicBase = required(this.config, 'STORAGE_S3_PUBLIC_BASE').replace(/\/$/, '');
    }
    return `${this.publicBase}/${sanitizeKey(key)}`;
  }

  private ensureClient(): { client: S3Client; bucket: string } {
    if (this.client) return { client: this.client, bucket: this.bucket };

    this.bucket = required(this.config, 'STORAGE_S3_BUCKET');
    this.publicBase = required(this.config, 'STORAGE_S3_PUBLIC_BASE').replace(/\/$/, '');

    const region = required(this.config, 'STORAGE_S3_REGION');
    const endpoint = this.config.get<string>('STORAGE_S3_ENDPOINT'); // optional
    const accessKeyId = required(this.config, 'STORAGE_S3_ACCESS_KEY_ID');
    const secretAccessKey = required(this.config, 'STORAGE_S3_SECRET_ACCESS_KEY');

    this.client = new S3Client({
      region,
      ...(endpoint && { endpoint, forcePathStyle: true }),
      credentials: { accessKeyId, secretAccessKey },
    });
    this.logger.log(
      `S3 storage on bucket "${this.bucket}" (${endpoint ?? 'aws'}) → ${this.publicBase}/*`,
    );
    return { client: this.client, bucket: this.bucket };
  }
}

function required(config: ConfigService, name: string): string {
  const v = config.get<string>(name);
  if (!v) {
    throw new Error(
      `STORAGE_DRIVER=s3 requires ${name}; set it in api/.env or switch to STORAGE_DRIVER=local.`,
    );
  }
  return v;
}

function sanitizeKey(key: string): string {
  // S3 happily takes any UTF-8 key, but leading slashes create a phantom empty
  // path segment that breaks public URL composition.
  return key.replace(/^\/+/, '');
}
