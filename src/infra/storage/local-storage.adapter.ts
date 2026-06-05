import { promises as fs } from 'fs';
import * as path from 'path';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  StorageAdapter,
  StorageUploadArgs,
  StorageUploadResult,
} from './storage.adapter';

/**
 * Local-disk storage driver. Files land under `storage/uploads/` relative to
 * the api's cwd (which is `/app` inside Docker, bind-mounted to ./api). Public
 * access happens via Express static middleware mounted at `/uploads/*` in
 * main.ts — only enabled when STORAGE_DRIVER=local.
 *
 * Not safe to use behind multiple api replicas (each replica has its own disk).
 * Switch to the S3 driver for any environment with horizontal scaling.
 */
@Injectable()
export class LocalStorageAdapter extends StorageAdapter {
  private readonly logger = new Logger(LocalStorageAdapter.name);
  private readonly rootDir: string;
  private readonly apiOrigin: string;
  private readonly publicPathPrefix: string;

  constructor(config: ConfigService) {
    super();
    // Resolve under the api process cwd so it works identically inside Docker
    // (cwd=/app, volume-mounted) and in any `pnpm dev` host run.
    this.rootDir = path.resolve(
      process.cwd(),
      config.get<string>('STORAGE_LOCAL_DIR') ?? 'storage/uploads',
    );
    this.apiOrigin = (
      config.get<string>('API_ORIGIN') ?? 'http://localhost:3001'
    ).replace(/\/$/, '');
    this.publicPathPrefix = (
      config.get<string>('STORAGE_LOCAL_PUBLIC_PREFIX') ?? '/uploads'
    ).replace(/\/$/, '');

    this.logger.log(
      `Local storage rooted at ${this.rootDir} → ${this.apiOrigin}${this.publicPathPrefix}/*`,
    );
  }

  /** Where the static middleware should serve from (used by main.ts). */
  getServingRoot(): { fsRoot: string; urlPrefix: string } {
    return { fsRoot: this.rootDir, urlPrefix: this.publicPathPrefix };
  }

  async upload(args: StorageUploadArgs): Promise<StorageUploadResult> {
    const safeKey = this.safeKey(args.key);
    const absPath = path.join(this.rootDir, safeKey);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, args.body);
    return { url: this.getPublicUrl(safeKey), key: safeKey };
  }

  async delete(key: string): Promise<void> {
    const safeKey = this.safeKey(key);
    const absPath = path.join(this.rootDir, safeKey);
    try {
      await fs.unlink(absPath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
  }

  getPublicUrl(key: string): string {
    return `${this.apiOrigin}${this.publicPathPrefix}/${this.safeKey(key)}`;
  }

  /**
   * Defensive — block `..` traversal and absolute paths. Keys are caller-owned
   * but the caller is always our own code; this is belt-and-suspenders.
   */
  private safeKey(key: string): string {
    const normalized = path.posix.normalize(key.replace(/^\/+/, ''));
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return normalized;
  }
}
