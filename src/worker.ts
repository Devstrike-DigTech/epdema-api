import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { WorkerAppModule } from './worker.module';

/**
 * Worker process entrypoint. Boots a minimal Nest container, leaves the
 * BullMQ worker running, and shuts cleanly on SIGINT/SIGTERM. No HTTP port
 * is opened — Railway / docker-compose run this side-by-side with the API.
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('Worker');
  const app = await NestFactory.createApplicationContext(WorkerAppModule, {
    // bufferLogs would hide startup output until app.useLogger() is called —
    // we never swap loggers, so leave it off so Docker logs show boot progress.
    bufferLogs: false,
  });
  app.enableShutdownHooks();
  logger.log('👷  EPDEMA worker started — consuming queue "epdema"');

  // Keep the event loop alive without busy-waiting. Nest's shutdown hooks
  // close the BullMQ Worker which in turn releases the Redis connection.
  await new Promise<void>((resolve) => {
    const shutdown = (signal: NodeJS.Signals) => {
      logger.log(`Received ${signal}, draining…`);
      void app.close().then(resolve);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
}

void bootstrap().catch((err) => {
  console.error('Worker failed to start:', err);
  process.exit(1);
});
