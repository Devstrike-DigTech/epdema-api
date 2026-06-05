import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AiUsageService } from './ai-usage.service';

/**
 * Per-event spend cap. The default is $0.50 / event (50 cents) — generous
 * enough for ~30-50 Sonnet calls with prompt caching, tight enough that a
 * jailbroken loop dies at request 51, not 5,000.
 *
 * The cap is read from env at the AiAdapter call site so it can be raised
 * for a specific deploy without a code change. A future slice (6·F) will
 * expose this as a tier-specific feature flag so Marquee gets a higher cap.
 */
const DEFAULT_PER_EVENT_BUDGET_USD = 0.5;
/**
 * Phase 6·C — per-actor 24h cap, used by pre-creation flows (e.g. the copilot)
 * that don't have an eventId yet. Lower than the per-event cap because Opus
 * costs 5× Sonnet — 30¢ ≈ 3 copilot drafts per user per day.
 */
const DEFAULT_PER_ACTOR_DAILY_USD = 0.3;

@Injectable()
export class AiBudgetGuard {
  private readonly perEventCapMinor: number;
  private readonly perActorDailyCapMinor: number;

  constructor(
    config: ConfigService,
    private readonly usage: AiUsageService,
  ) {
    const eventFromEnv = Number(config.get<string>('AI_PER_EVENT_BUDGET_USD'));
    const eventDollars = Number.isFinite(eventFromEnv) && eventFromEnv > 0
      ? eventFromEnv
      : DEFAULT_PER_EVENT_BUDGET_USD;
    this.perEventCapMinor = Math.round(eventDollars * 100);

    const actorFromEnv = Number(config.get<string>('AI_PER_ACTOR_DAILY_USD'));
    const actorDollars = Number.isFinite(actorFromEnv) && actorFromEnv > 0
      ? actorFromEnv
      : DEFAULT_PER_ACTOR_DAILY_USD;
    this.perActorDailyCapMinor = Math.round(actorDollars * 100);
  }

  /**
   * Throws 429 Too Many Requests when the running per-event spend has
   * already crossed the cap. Called BEFORE every AiAdapter completion so
   * the failing call never actually hits Anthropic. Null eventId = system-
   * wide dry-run, exempt from the per-event cap.
   */
  async assertWithinBudget(eventId: string | null): Promise<void> {
    const spent = await this.usage.sumCostForEvent(eventId);
    if (spent >= this.perEventCapMinor) {
      throw new HttpException(
        {
          message:
            "This event has reached its AI budget for now. Suggestions will resume next billing cycle, or upgrade the tier for a higher cap.",
          spentCents: spent,
          capCents: this.perEventCapMinor,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * Phase 6·C — per-actor 24h cap. Used by the pre-creation copilot
   * (no eventId yet) so a single user can't burn the Opus budget across a
   * day. The query rolls a 24-hour window (not calendar day) so the cap
   * doesn't reset at midnight UTC and let a returning user re-burn it.
   */
  async assertWithinActorDailyBudget(actorUserId: string | null): Promise<void> {
    if (!actorUserId) return; // unauthenticated callers aren't reached here
    const spent = await this.usage.sumCostForActorRollingDay(actorUserId);
    if (spent >= this.perActorDailyCapMinor) {
      throw new HttpException(
        {
          message:
            "You've reached the daily AI copilot limit. Try again in a few hours, or finish drafting your event manually.",
          spentCents: spent,
          capCents: this.perActorDailyCapMinor,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Returns the cap so feature surfaces can show progress bars. */
  get capCentsForEvent(): number {
    return this.perEventCapMinor;
  }

  get capCentsForActorDaily(): number {
    return this.perActorDailyCapMinor;
  }
}
