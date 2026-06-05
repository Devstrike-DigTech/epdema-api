import * as Sentry from '@sentry/node';

/**
 * Initialise Sentry at process start — must run BEFORE NestFactory.create so
 * exceptions thrown during DI / module init are still captured.
 *
 * No-op when `SENTRY_DSN` is empty (dev default). Returns true if Sentry
 * was actually initialised — callers use this to gate request-tag setup.
 */
export function initSentry(): boolean {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;

  const environment = process.env.NODE_ENV ?? 'development';
  Sentry.init({
    dsn,
    environment,
    // Release tag — wire to git sha via `--build-arg` once CI lands;
    // for now the package.json version is the best stable identifier we
    // have. Sentry deduplicates events across releases, so a stable name
    // is more important than a perfectly-fresh value.
    release: process.env.SENTRY_RELEASE ?? 'epdema-api@0.1.0',
    // Sample rates: 100% errors in dev/staging, capped in prod once we see
    // real volume. Tracing is OFF for the private-beta — adds latency
    // without paying off until we have multi-service correlations.
    sampleRate: 1.0,
    tracesSampleRate: 0,
    // Drop noise that won't help debugging:
    //   - 4xx HttpExceptions (these are usually user input, not bugs)
    //   - validation errors (already in 4xx)
    // The GlobalExceptionFilter passes only 5xx + non-HttpException errors
    // to Sentry, so this is belt-and-braces. The check here also catches
    // exceptions that escape the filter (e.g. during boot).
    beforeSend(event, hint) {
      const err = hint?.originalException;
      if (err && typeof err === 'object' && 'getStatus' in err) {
        const status = (err as { getStatus: () => number }).getStatus();
        if (status < 500) return null;
      }
      return event;
    },
  });
  return true;
}

/**
 * Force-flush any queued events before process exit. The Sentry SDK batches
 * sends; we don't want the process to die with events still in the queue.
 * Called from main.ts on SIGTERM / SIGINT for graceful shutdown.
 */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!process.env.SENTRY_DSN) return;
  await Sentry.flush(timeoutMs);
}
