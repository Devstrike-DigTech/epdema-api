import { plainToInstance, Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, IsUrl, MinLength, validateSync } from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Staging = 'staging',
  Production = 'production',
  Test = 'test',
}

class Env {
  @IsEnum(NodeEnv)
  NODE_ENV!: NodeEnv;

  // Explicit @Type so tsx (esbuild — no decorator metadata) can still coerce
  // the string `"3001"` from process.env into a number for the worker process.
  @Type(() => Number)
  @IsNumber()
  PORT: number = 3001;

  // ── Postgres
  @IsString()
  DATABASE_URL!: string;

  // ── Redis
  @IsString()
  REDIS_URL!: string;

  // ── Better Auth
  @IsString()
  @MinLength(32, { message: 'BETTER_AUTH_SECRET must be at least 32 chars (use `openssl rand -hex 32`)' })
  BETTER_AUTH_SECRET!: string;

  @IsUrl({ require_tld: false })
  BETTER_AUTH_URL!: string;

  // ── CORS
  @IsUrl({ require_tld: false })
  WEB_ORIGIN!: string;

  // ── Paystack
  @IsString()
  PAYSTACK_SECRET_KEY!: string;

  @IsString()
  PAYSTACK_PUBLIC_KEY!: string;

  // ── Resend
  @IsString()
  RESEND_API_KEY!: string;

  @IsString()
  EMAIL_FROM!: string;

  // ── Anthropic — optional. When absent (`sk-ant-…` not set) the AiAdapter
  // returns canned dev-fallback responses so feature work doesn't need a real
  // API budget. Phase 6 will require this in prod via deploy env vars.
  @IsOptional()
  @IsString()
  ANTHROPIC_API_KEY?: string;

  /** Optional override — defaults to `claude-sonnet-4-5`. */
  @IsOptional()
  @IsString()
  ANTHROPIC_DEFAULT_MODEL?: string;

  /** Optional override for copilot/premium paths — defaults to `claude-opus-4-7`. */
  @IsOptional()
  @IsString()
  ANTHROPIC_COPILOT_MODEL?: string;

  // ── Google Places
  @IsString()
  GOOGLE_PLACES_API_KEY!: string;

  // ── Observability (optional in dev)
  @IsOptional()
  @IsString()
  SENTRY_DSN?: string;

  @IsOptional()
  @IsString()
  LOG_LEVEL?: string;

  // ── Storage (Phase 5c·D — branding assets). All optional in dev because
  // STORAGE_DRIVER defaults to "local" with sensible fallbacks.
  @IsOptional()
  @IsEnum(['local', 's3'] as const, {
    message: 'STORAGE_DRIVER must be "local" or "s3"',
  })
  STORAGE_DRIVER?: 'local' | 's3';

  @IsOptional()
  @IsString()
  STORAGE_LOCAL_DIR?: string;

  @IsOptional()
  @IsString()
  STORAGE_LOCAL_PUBLIC_PREFIX?: string;

  @IsOptional()
  @IsString()
  API_ORIGIN?: string;

  // S3 driver fields — only required when STORAGE_DRIVER=s3. The adapter
  // throws at boot if any are missing, so we leave them all optional here.
  @IsOptional()
  @IsString()
  STORAGE_S3_BUCKET?: string;

  @IsOptional()
  @IsString()
  STORAGE_S3_REGION?: string;

  @IsOptional()
  @IsString()
  STORAGE_S3_ENDPOINT?: string;

  @IsOptional()
  @IsString()
  STORAGE_S3_ACCESS_KEY_ID?: string;

  @IsOptional()
  @IsString()
  STORAGE_S3_SECRET_ACCESS_KEY?: string;

  @IsOptional()
  @IsString()
  STORAGE_S3_PUBLIC_BASE?: string;

  // ── Phase 5.7·C — Social auth providers. All optional; Better Auth's
  // `socialProviders` block only registers a provider when its pair is set.

  @IsOptional()
  @IsString()
  GOOGLE_CLIENT_ID?: string;

  @IsOptional()
  @IsString()
  GOOGLE_CLIENT_SECRET?: string;

  @IsOptional()
  @IsString()
  APPLE_CLIENT_ID?: string;

  @IsOptional()
  @IsString()
  APPLE_TEAM_ID?: string;

  @IsOptional()
  @IsString()
  APPLE_KEY_ID?: string;

  /**
   * Apple sign-in private key — the `.p8` file's contents including the
   * BEGIN/END PRIVATE KEY lines, with newlines preserved (use `\n` in env
   * files since Docker doesn't strip them).
   */
  @IsOptional()
  @IsString()
  APPLE_PRIVATE_KEY?: string;
}

export function validateEnv(config: Record<string, unknown>): Env {
  const validated = plainToInstance(Env, config, { enableImplicitConversion: true });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    const messages = errors
      .map((e) => `  - ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${messages}`);
  }
  return validated;
}
