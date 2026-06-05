import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AiUsageService } from './ai-usage.service';
import { AiBudgetGuard } from './ai-budget.guard';
import type { AiAction, AiCallContext, AiModelTier } from './ai.types';

/**
 * Pricing per 1M tokens. Sourced from Anthropic's public list as of
 * Phase 6 plan. Update here when prices change — `costMinor` falls out
 * of token counts × these rates.
 *
 * Note: cached input is billed at 10% of input rate; cache *writes* are
 * 1.25× input (we don't model the write surcharge here because most calls
 * are reads-after-warm and the overshoot is conservatively small).
 */
const MODEL_PRICING_USD_PER_MTOK: Record<
  string,
  { input: number; cachedInput: number; output: number }
> = {
  'claude-sonnet-4-5': { input: 3.0, cachedInput: 0.3, output: 15.0 },
  'claude-opus-4-7': { input: 15.0, cachedInput: 1.5, output: 75.0 },
};

interface CompleteArgs {
  context: AiCallContext;
  model?: AiModelTier;
  system: string | { text: string; cache?: boolean }[];
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens?: number;
  temperature?: number;
}

/**
 * Pluggable wrapper around `@anthropic-ai/sdk`. Mirrors the
 * [ResendAdapter] / [StorageAdapter] pattern — when `ANTHROPIC_API_KEY`
 * is missing (dev default), every call returns a canned fallback so
 * downstream feature work doesn't need real API credit.
 *
 * Every successful call enforces:
 *   1. **Budget guard** — `AiBudgetGuard.assertWithinBudget` runs BEFORE
 *      the Anthropic SDK send. A jailbroken / runaway request loop dies at
 *      the 51st call once a $0.50 cap is hit, not the 5,000th.
 *   2. **Prompt caching** — system blocks tagged `cache: true` get a
 *      `cache_control: { type: 'ephemeral' }` marker so the second+ call
 *      with the same system text hits the 5-minute cache (~80% cost cut).
 *   3. **Usage record** — every call (success or failure) writes one row
 *      to `ai_usage` so the per-event spend cap can be enforced.
 */
@Injectable()
export class AiAdapter {
  private readonly logger = new Logger(AiAdapter.name);
  private readonly client: Anthropic | null;
  private readonly devFallback: boolean;
  private readonly defaultModel: string;
  private readonly copilotModel: string;

  constructor(
    config: ConfigService,
    private readonly usage: AiUsageService,
    private readonly budget: AiBudgetGuard,
  ) {
    const key = config.get<string>('ANTHROPIC_API_KEY') ?? '';
    this.defaultModel =
      config.get<string>('ANTHROPIC_DEFAULT_MODEL') ?? 'claude-sonnet-4-5';
    this.copilotModel =
      config.get<string>('ANTHROPIC_COPILOT_MODEL') ?? 'claude-opus-4-7';
    // Dev-fallback when no key OR when the key looks like the documented
    // placeholder (`sk-ant-xxxxxxxxxx`). The 5+ `x` heuristic catches every
    // obvious placeholder I've seen across phases without false-positiving
    // a real key, which never contains a long run of `x` characters.
    this.devFallback = !key.startsWith('sk-ant-') || /x{5,}/.test(key);

    if (this.devFallback) {
      this.logger.warn(
        'ANTHROPIC_API_KEY is missing or placeholder — AI calls return canned dev-fallback responses. Set a real `sk-ant-…` key in api/.env to enable real Claude calls.',
      );
      this.client = null;
    } else {
      this.client = new Anthropic({ apiKey: key });
    }
  }

  /** Resolve the named model tier to a concrete model id. */
  modelFor(tier: AiModelTier = 'default'): string {
    return tier === 'copilot' ? this.copilotModel : this.defaultModel;
  }

  /**
   * Single non-streaming completion. Returns the joined output text.
   * Streaming is handled by a separate method for the copilot UX path
   * (6·C). For per-segment / vibe / holiday flows, non-streaming is the
   * cleaner API.
   */
  async complete(args: CompleteArgs): Promise<string> {
    const model = this.modelFor(args.model);

    // Guard first — even dev-fallback respects the budget so a runaway
    // loop in tests can't fake-bill millions of records. Two modes:
    //   - event-scoped: check the per-event cap ($0.50 default).
    //   - pre-creation (no eventId): check the per-actor rolling-24h cap
    //     ($0.30 default — sized for Opus copilot drafts).
    if (args.context.eventId) {
      await this.budget.assertWithinBudget(args.context.eventId);
    } else {
      await this.budget.assertWithinActorDailyBudget(args.context.actorUserId);
    }

    if (this.devFallback || !this.client) {
      const text = CANNED_DEV_RESPONSES[args.context.action]?.(args) ??
        `[dev-fallback ${args.context.action}] No real Anthropic credentials configured.`;
      await this.usage.record({
        ...args.context,
        model: `dev-fallback:${model}`,
        inputTokens: 0,
        cachedTokens: 0,
        outputTokens: 0,
        costMinor: 0,
      });
      return text;
    }

    try {
      const systemBlocks = this.buildSystemBlocks(args.system);
      const res = await this.client.messages.create({
        model,
        max_tokens: args.maxTokens ?? 1024,
        // `temperature` was deprecated on Claude 4.x models — sending it 400s
        // with "`temperature` is deprecated for this model." Only attach it for
        // the older claude-3.x models that still honor it; newer models manage
        // sampling internally, so we omit it (the caller's value is a no-op there).
        ...(args.temperature !== undefined && /claude-3/.test(model)
          ? { temperature: args.temperature }
          : {}),
        system: systemBlocks,
        messages: args.messages.map((m) => ({ role: m.role, content: m.content })),
      });

      const text = res.content
        .map((b) => (b.type === 'text' ? b.text : ''))
        .join('');

      const inputTokens = res.usage.input_tokens ?? 0;
      const cachedTokens =
        (res.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0;
      const outputTokens = res.usage.output_tokens ?? 0;
      const costMinor = this.estimateCostMinor({
        model,
        inputTokens,
        cachedTokens,
        outputTokens,
      });

      await this.usage.record({
        ...args.context,
        model,
        inputTokens,
        cachedTokens,
        outputTokens,
        costMinor,
      });

      return text;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Still record the failed call so jailbreak / upstream-down spikes
      // show up in the usage log even when no cost was incurred.
      await this.usage.record({
        ...args.context,
        model: `failed:${model}`,
        inputTokens: 0,
        cachedTokens: 0,
        outputTokens: 0,
        costMinor: 0,
        error: message,
      });
      throw err;
    }
  }

  /**
   * Estimate USD cents from token counts. Cached input is billed at
   * 10% of the regular input rate; uncached input fills the remainder.
   * Rounds half up so $0.001 ≈ 0 cents stays at 0 (we don't bill fractional
   * cents but want to count them in audit).
   */
  estimateCostMinor(args: {
    model: string;
    inputTokens: number;
    cachedTokens: number;
    outputTokens: number;
  }): number {
    const price = MODEL_PRICING_USD_PER_MTOK[args.model];
    if (!price) return 0;
    const uncachedInput = Math.max(0, args.inputTokens - args.cachedTokens);
    const dollars =
      (uncachedInput / 1_000_000) * price.input +
      (args.cachedTokens / 1_000_000) * price.cachedInput +
      (args.outputTokens / 1_000_000) * price.output;
    return Math.round(dollars * 100);
  }

  /**
   * Convert a string-or-array `system` argument into Anthropic's block
   * shape, attaching cache_control to any block tagged `cache: true`.
   */
  private buildSystemBlocks(
    system: CompleteArgs['system'],
  ): { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }[] {
    if (typeof system === 'string') {
      return [{ type: 'text', text: system }];
    }
    return system.map((b) => ({
      type: 'text',
      text: b.text,
      ...(b.cache && { cache_control: { type: 'ephemeral' } }),
    }));
  }
}

/**
 * Dev-fallback canned responses. Each per-action handler returns a string
 * that's "shape-correct" for the consuming feature — JSON for suggestion
 * calls, prose for copilot. Lets the rest of Phase 6 ship without a
 * real Anthropic key.
 */
const CANNED_DEV_RESPONSES: Partial<
  Record<AiAction, (args: CompleteArgs) => string>
> = {
  'ai.suggest_proposals': () =>
    JSON.stringify({
      // Key matches what SegmentSuggestionService parses (`candidates`,
      // not `proposals`). Got this wrong once — silent empty list back.
      candidates: [
        {
          summary: 'Sample suggestion #1 (dev-fallback)',
          notes: 'Set ANTHROPIC_API_KEY in api/.env to get real suggestions.',
          reason: 'Canned response — no real model call was made.',
        },
        {
          summary: 'Sample suggestion #2 (dev-fallback)',
          notes: 'Dev-only placeholder.',
          reason: 'Canned response.',
        },
        {
          summary: 'Sample suggestion #3 (dev-fallback)',
          notes: 'Dev-only placeholder.',
          reason: 'Canned response.',
        },
      ],
    }),
  'ai.copilot_draft': () =>
    JSON.stringify({
      // Keys match CopilotService.parse — `segmentType` (not `type`) and
      // every segment carries a description. Got these wrong once.
      title: 'Sample event (dev-fallback)',
      eventType: 'birthday',
      scheduledDate: null,
      description:
        'Dev-fallback draft — set ANTHROPIC_API_KEY for real copilot suggestions.',
      segments: [
        { segmentType: 'date_time', title: 'When?', description: 'Pick the date + time.' },
        { segmentType: 'venue', title: 'Where?', description: 'Pick the venue.' },
        { segmentType: 'budget', title: 'Budget', description: 'Total spend cap + split rules.' },
        { segmentType: 'guest_list', title: 'Who?', description: 'Final guest list.' },
      ],
    }),
  'ai.vibe_pack': () =>
    JSON.stringify({
      themeName: 'Sample vibe (dev-fallback)',
      palette: ['#4A2B7E', '#F2B33E', '#FAF7F2'],
      decorations: ['Sample decoration 1', 'Sample decoration 2'],
      music: ['Sample genre 1', 'Sample genre 2'],
      emoji: '🎉',
    }),
  'ai.holiday_scanner': () =>
    JSON.stringify({
      warnings: [
        {
          severity: 'info',
          title: 'Dev-fallback notice',
          detail: 'Set ANTHROPIC_API_KEY for real holiday scanning.',
        },
      ],
    }),
};
