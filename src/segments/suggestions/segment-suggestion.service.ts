import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { MembersService } from '../../members/members.service';
import { AiAdapter } from '../../infra/ai/ai.adapter';
import { AuditService } from '../../infra/audit/audit.service';

export interface SegmentSuggestionCandidate {
  /** Short title for the proposal (shown on the proposal card). */
  summary: string;
  /** Longer body / rationale shown when the card is expanded. */
  notes: string;
  /** Why this suggestion fits — surfaced to the admin in the picker. */
  reason: string;
  /** Optional typed payload (price for budget segments, ISO date for date segments). */
  typed?: Record<string, unknown>;
}

export interface SegmentSuggestionResponse {
  candidates: SegmentSuggestionCandidate[];
  /** How many cents this single call spent — surface for cost-visibility. */
  costCents: number;
}

/**
 * The system prompt is the long cacheable part of every call. Anthropic's
 * ephemeral cache (5-min TTL) means the second segment-suggest on the same
 * event hits the cache for ~80% input-cost cut. We tag this with
 * `cache: true` in the call site.
 */
const SYSTEM_PROMPT = `You are EPDEMA's planning copilot. Your single job is to suggest 3 to 5 concrete proposal candidates for one specific segment of a planned event, given the event context.

CRITICAL OUTPUT FORMAT:
Respond with a single JSON object, nothing else. No prose, no markdown fences.

{
  "candidates": [
    {
      "summary": "Short title (≤80 chars). Imperative or noun phrase.",
      "notes": "1-3 sentences explaining the proposal concretely.",
      "reason": "Why this fits THIS event (mention specific context — date, other locked decisions, etc.)",
      "typed": { /* optional, only set if the segment type warrants it */ }
    }
  ]
}

When the segment type warrants typed data, include a "typed" object:
- "venue":     { "name": "...", "address": "...", "capacity": 120, "indoor": true }
- "budget":    { "amountMinor": "500000", "currency": "NGN" }
- "date_time": { "iso": "2026-06-24T18:00:00+01:00" }
- "guest_list":{ "estimate": 60 }
- "theme":     { "palette": ["#…", "#…"] }

RULES:
- 3 to 5 candidates. Quality over quantity. Don't pad.
- Each candidate must be DIFFERENT (different venue style, different budget tier, different vibe — not minor variations).
- If existing proposals are provided, DO NOT duplicate them. Reference them in your "reason" when proposing something complementary.
- Match the cultural / geographic context implied by the event (currency, names, venues — use NGN and Nigeria-default unless the event mentions otherwise).
- Respect the user's optional steer prompt verbatim if provided.
- Never invent decisions that the segment isn't about. Suggest "Venue X" for a venue segment, not "Venue X plus a band".

If the segment is too ambiguous to suggest anything useful, return { "candidates": [] } — empty is better than wrong.`;

@Injectable()
export class SegmentSuggestionService {
  private readonly logger = new Logger(SegmentSuggestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly members: MembersService,
    private readonly ai: AiAdapter,
    private readonly audit: AuditService,
  ) {}

  /**
   * Suggest 3-5 proposal candidates for `segmentId` on `eventId`. Tier-gated
   * (Occasion+ via `features.ai.perSegmentSuggestions`); admin-only.
   *
   * Cost-tracked via [AiAdapter] which also enforces the per-event budget.
   * Returns the parsed candidate list + the cents this call cost so the
   * UI can show a tiny "≈₦X" badge next to the suggestions.
   */
  async suggest(args: {
    eventId: string;
    segmentId: string;
    actorUserId: string;
    /** Optional free-form steer ("focus on Lagos vendors", "low-budget"). */
    steer?: string;
  }): Promise<SegmentSuggestionResponse> {
    await this.members.assertAdminOrThrow(args.actorUserId, args.eventId);

    const event = await this.prisma.event.findUnique({
      where: { id: args.eventId },
      include: {
        segments: {
          orderBy: { position: 'asc' },
          select: {
            id: true,
            title: true,
            segmentType: true,
            description: true,
            state: true,
            lockedValue: true,
          },
        },
      },
    });
    if (!event) throw new NotFoundException('Event not found.');

    const f = (event.features ?? {}) as { ai?: { perSegmentSuggestions?: boolean } };
    if (f.ai?.perSegmentSuggestions !== true) {
      throw new ForbiddenException(
        'AI proposal suggestions are an Occasion-tier feature. Upgrade the event to use them.',
      );
    }

    const segment = event.segments.find((s) => s.id === args.segmentId);
    if (!segment) throw new NotFoundException('Segment not found on this event.');

    // Pull existing live proposals so we can tell Claude what NOT to repeat.
    const existingProposals = await this.prisma.proposal.findMany({
      where: { segmentId: args.segmentId, state: 'live' },
      select: { payload: true },
      take: 25,
    });

    const userMessage = this.buildUserMessage({
      eventTitle: event.title,
      eventType: event.eventType,
      scheduledDate: event.scheduledDate?.toISOString().slice(0, 10) ?? null,
      description: event.description,
      currency: event.currency,
      segment,
      otherSegments: event.segments.filter((s) => s.id !== args.segmentId),
      existingProposals: existingProposals
        .map((p) => p.payload as { summary?: string })
        .map((p) => p.summary)
        .filter((s): s is string => typeof s === 'string'),
      steer: args.steer?.trim() || undefined,
    });

    const rawText = await this.ai.complete({
      context: {
        action: 'ai.suggest_proposals',
        eventId: args.eventId,
        actorUserId: args.actorUserId,
      },
      // System prompt is constant per phase — every call after the first
      // within a 5-min window hits the ephemeral cache.
      system: [{ text: SYSTEM_PROMPT, cache: true }],
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 1500,
    });

    const candidates = this.parseCandidates(rawText);
    const costCents = await this.lastCallCostFor(args.eventId);

    await this.audit.record({
      action: 'ai.suggest_proposals',
      actorUserId: args.actorUserId,
      eventId: args.eventId,
      details: {
        segmentId: args.segmentId,
        candidateCount: candidates.length,
        steer: args.steer?.trim() || null,
      },
    });

    return { candidates, costCents };
  }

  // ── helpers ──────────────────────────────────────────────────────────

  private buildUserMessage(args: {
    eventTitle: string;
    eventType: string;
    scheduledDate: string | null;
    description: string | null;
    currency: string;
    segment: {
      title: string;
      segmentType: string;
      description: string | null;
      state: string;
      lockedValue: unknown;
    };
    otherSegments: {
      title: string;
      segmentType: string;
      state: string;
      lockedValue: unknown;
    }[];
    existingProposals: string[];
    steer?: string;
  }): string {
    const lockedSummary = args.otherSegments
      .filter((s) => s.state === 'locked' && s.lockedValue)
      .map((s) => `- ${s.title} (${s.segmentType}): ${this.summariseLocked(s.lockedValue)}`)
      .join('\n');

    const openOthers = args.otherSegments
      .filter((s) => s.state !== 'locked')
      .map((s) => `- ${s.title} (${s.segmentType})`)
      .join('\n');

    const existing = args.existingProposals.length
      ? `\nExisting proposals already in this segment (do not repeat):\n${args.existingProposals
          .map((s) => `- ${s}`)
          .join('\n')}`
      : '';

    return `Event: "${args.eventTitle}" (${args.eventType})
Currency: ${args.currency}
${args.scheduledDate ? `Scheduled date: ${args.scheduledDate}` : 'Scheduled date: not yet decided'}
${args.description ? `Organizer's notes: ${args.description}` : ''}

Segment to suggest proposals for:
- Title: ${args.segment.title}
- Type:  ${args.segment.segmentType}
${args.segment.description ? `- Notes: ${args.segment.description}` : ''}

${lockedSummary ? `Already-decided segments to respect:\n${lockedSummary}\n` : ''}
${openOthers ? `Other still-open segments (for context, no need to address them):\n${openOthers}\n` : ''}
${existing}
${args.steer ? `\nOrganizer's steer: ${args.steer}\n` : ''}
Return the JSON object now.`;
  }

  /** Compact a Prisma JSON locked value for the prompt. */
  private summariseLocked(value: unknown): string {
    if (value == null) return 'unspecified';
    if (typeof value === 'string') return value;
    try {
      const v = value as { summary?: string; notes?: string };
      if (v.summary) return v.summary;
    } catch {
      /* fallthrough */
    }
    return JSON.stringify(value).slice(0, 120);
  }

  /**
   * Parse Claude's JSON response. Defensive — if the model wrapped it in
   * a code fence, strip that. Returns [] on any parse error so the UI shows
   * "no suggestions" rather than 500ing.
   */
  private parseCandidates(raw: string): SegmentSuggestionCandidate[] {
    let trimmed = raw.trim();
    // Strip ```json … ``` fences if the model added them despite instructions.
    if (trimmed.startsWith('```')) {
      trimmed = trimmed
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
    }
    try {
      const parsed = JSON.parse(trimmed) as {
        candidates?: Partial<SegmentSuggestionCandidate>[];
      };
      const list = Array.isArray(parsed.candidates) ? parsed.candidates : [];
      return list
        .filter(
          (c): c is SegmentSuggestionCandidate =>
            typeof c.summary === 'string' &&
            typeof c.notes === 'string' &&
            typeof c.reason === 'string',
        )
        .slice(0, 5);
    } catch (err) {
      this.logger.warn(
        `AI suggestion JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  /**
   * Read the cost of the most recent `ai_usage` row for this event — we just
   * inserted it via the adapter, so this is essentially "what did the call
   * I just made cost?". One small extra query beats threading the cost back
   * through the AiAdapter return signature.
   */
  private async lastCallCostFor(eventId: string): Promise<number> {
    const row = await this.prisma.aiUsage.findFirst({
      where: { eventId, action: 'ai.suggest_proposals' },
      orderBy: { createdAt: 'desc' },
      select: { costMinor: true },
    });
    return row?.costMinor ?? 0;
  }
}
