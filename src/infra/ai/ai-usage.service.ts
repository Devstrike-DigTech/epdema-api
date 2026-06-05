import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import type { AiCallContext, AiUsageRecord } from './ai.types';

interface RecordArgs extends AiCallContext, AiUsageRecord {
  error?: string;
}

/**
 * Thin wrapper around the `ai_usage` Prisma model. Two responsibilities:
 *   - `record(...)` writes one row per AI call (success or failure).
 *   - `sumCostForEvent(eventId)` returns the running per-event spend used
 *     by [AiBudgetGuard] to enforce the cap.
 */
@Injectable()
export class AiUsageService {
  constructor(private readonly prisma: PrismaService) {}

  async record(args: RecordArgs): Promise<void> {
    await this.prisma.aiUsage.create({
      data: {
        eventId: args.eventId,
        actorUserId: args.actorUserId,
        action: args.action,
        model: args.model,
        inputTokens: args.inputTokens,
        cachedTokens: args.cachedTokens,
        outputTokens: args.outputTokens,
        costMinor: args.costMinor,
        error: args.error ?? null,
      },
    });
  }

  /**
   * Total spend on a given event so far (USD cents). Returns 0 when the
   * event has no AI history yet — also the path taken on null eventId
   * (system-wide dry-runs aren't event-scoped, so they pass the guard).
   */
  async sumCostForEvent(eventId: string | null): Promise<number> {
    if (!eventId) return 0;
    const result = await this.prisma.aiUsage.aggregate({
      where: { eventId },
      _sum: { costMinor: true },
    });
    return result._sum.costMinor ?? 0;
  }

  /**
   * Phase 6·C — rolling 24h spend for an actor across ALL events (including
   * null-event pre-creation calls). Used by the actor-budget guard on the
   * copilot path. Rolling window (now - 24h, not "today UTC") so a user
   * can't burn their cap, wait until midnight, and burn it again.
   */
  async sumCostForActorRollingDay(actorUserId: string): Promise<number> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const result = await this.prisma.aiUsage.aggregate({
      where: { actorUserId, createdAt: { gte: since } },
      _sum: { costMinor: true },
    });
    return result._sum.costMinor ?? 0;
  }
}
