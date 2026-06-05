/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */
/**
 * Static OpenAPI document generator.
 *
 * Boots the same `AppModule` the runtime uses, calls `SwaggerModule.createDocument`,
 * writes the result to `api/openapi.json`. The generated file is the single source
 * of truth that downstream codegen (web `openapi-typescript`, mobile
 * `openapi_generator_cli`) consumes.
 *
 * Usage:
 *   pnpm openapi:generate          # builds api, writes openapi.json
 *   pnpm openapi:check             # regenerates + git-diff-exit-codes (CI gate)
 *
 * Implementation notes — why compiled, not ts-node:
 *   The `@nestjs/swagger` plugin runs as a TypeScript transformer during
 *   `nest build`. It augments DTO classes with extra Reflect metadata derived
 *   from TS field types (so `name: string | null` ships as `nullable: true,
 *   type: 'string'` instead of an untyped `nullable: true`). ts-node doesn't
 *   run that transformer, which would produce a degraded spec that
 *   openapi-typescript renders as `Record<string, never> | null` for every
 *   nullable field. Solution: build first, then `node` the compiled output —
 *   the metadata baked into dist/ already reflects the plugin's pass.
 */

import 'reflect-metadata';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

// Lazy require so this file stays under TS but uses the JS module the build
// emitted — the JS carries the swagger-plugin's metadata that ts-node doesn't.
const { AppModule } = require(resolve(__dirname, '..', 'dist', 'app.module'));

/**
 * Bump on every committed change to the API surface. Rules in
 * `api/openapi-policy.md`:
 *   - Breaking change → major (1.x.y → 2.0.0)
 *   - Additive change → minor (1.5.y → 1.6.0)
 *   - Cosmetic change → patch (1.5.3 → 1.5.4)
 *
 * When in doubt, bump major. Commit `openapi.json` in the same PR.
 */
export const OPENAPI_VERSION = '1.0.0';

async function generate(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  try {
    const config = new DocumentBuilder()
      .setTitle('EPDEMA API')
      .setDescription(
        'Event Planning Decision Making Assistant. ' +
          'Spec frozen per Phase 5.5 — bump `info.version` (major for breaking, ' +
          'minor for additive) on every committed change.',
      )
      .setVersion(OPENAPI_VERSION)
      .addBearerAuth()
      .addCookieAuth('better-auth.session_token')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    const sorted = sortKeys(document);
    const outPath = resolve(__dirname, '..', 'openapi.json');
    writeFileSync(outPath, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
    // eslint-disable-next-line no-console
    console.log(`✓ Wrote ${outPath} (v${OPENAPI_VERSION})`);
  } finally {
    await app.close();
  }
}

/**
 * Recursively sort object keys so the emitted JSON is byte-stable across
 * Node versions and unrelated code edits. Arrays preserve order — they
 * usually represent an ordered list (paths, tags) where shuffling would
 * be a real semantic change.
 */
function sortKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => sortKeys(v)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) out[k] = sortKeys(v);
    return out as T;
  }
  return value;
}

generate().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('openapi generation failed:', err);
  process.exit(1);
});
