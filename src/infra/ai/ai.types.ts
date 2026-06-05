/**
 * Cross-cutting types for the Phase 6 AI plumbing. Keep this file tiny —
 * runtime details live in adapter / service files.
 */

/**
 * Which named model to use. Concrete versions resolve at adapter init time
 * from env (`ANTHROPIC_DEFAULT_MODEL` / `ANTHROPIC_COPILOT_MODEL`) with
 * sensible defaults.
 */
export type AiModelTier = 'default' | 'copilot';

/**
 * Stable identifier for what an AI call is for. Mirrors the audit-log
 * `action` convention (`noun.verb`) so the `ai_usage` table is grep-friendly.
 */
export type AiAction =
  | 'ai.suggest_proposals' // 6·B per-segment proposal suggestions
  | 'ai.copilot_draft' // 6·C pre-creation event copilot
  | 'ai.vibe_pack' // 6·D one-shot vibe pack
  | 'ai.holiday_scanner' // 6·E one-shot holiday scanner
  | 'ai.dry_run'; // dev-fallback path

export interface AiUsageRecord {
  /** Approximate USD cost in cents. Floored at 0. */
  costMinor: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  model: string;
}

export interface AiCallContext {
  action: AiAction;
  /** Null only for global dry-runs; every real call is event-scoped. */
  eventId: string | null;
  /** Null when triggered by a worker / cron, not a user request. */
  actorUserId: string | null;
}
