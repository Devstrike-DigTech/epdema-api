import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { StorageAdapter } from './storage.adapter';
import { LocalStorageAdapter } from './local-storage.adapter';
import { S3StorageAdapter } from './s3-storage.adapter';

/**
 * Picks a storage backend at boot based on `STORAGE_DRIVER` env. Falls back to
 * `local` if unset — fine for dev, NOT for prod. The decision is one-time at
 * module init; flipping drivers requires a restart.
 *
 * Marked @Global() so feature modules can `@Inject(StorageAdapter)` without
 * importing StorageModule everywhere.
 */
@Global()
@Module({
  providers: [
    LocalStorageAdapter,
    S3StorageAdapter,
    {
      provide: StorageAdapter,
      inject: [ConfigService, LocalStorageAdapter, S3StorageAdapter],
      useFactory: (
        config: ConfigService,
        local: LocalStorageAdapter,
        s3: S3StorageAdapter,
      ): StorageAdapter => {
        const driver = (config.get<string>('STORAGE_DRIVER') ?? 'local').toLowerCase();
        const logger = new Logger('StorageModule');
        switch (driver) {
          case 's3':
            logger.log('Storage driver: s3');
            return s3;
          case 'local':
            logger.log('Storage driver: local');
            return local;
          default:
            logger.warn(
              `Unknown STORAGE_DRIVER="${driver}" — falling back to local. Set STORAGE_DRIVER=local|s3.`,
            );
            return local;
        }
      },
    },
  ],
  exports: [StorageAdapter, LocalStorageAdapter],
})
export class StorageModule {}
