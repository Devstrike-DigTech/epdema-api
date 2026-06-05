import { Global, Module } from '@nestjs/common';

import { AiAdapter } from './ai.adapter';
import { AiBudgetGuard } from './ai-budget.guard';
import { AiUsageService } from './ai-usage.service';

/**
 * Phase 6·A — pluggable AI infrastructure. Other modules `@Inject(AiAdapter)`
 * (Global so we don't have to thread the import everywhere).
 *
 * Composition:
 *   AiAdapter      — the Anthropic SDK wrapper + dev-fallback + retries
 *   AiBudgetGuard  — per-event spend cap (default $0.50)
 *   AiUsageService — write-only sink for the `ai_usage` table
 */
@Global()
@Module({
  providers: [AiAdapter, AiBudgetGuard, AiUsageService],
  exports: [AiAdapter, AiBudgetGuard, AiUsageService],
})
export class AiModule {}
