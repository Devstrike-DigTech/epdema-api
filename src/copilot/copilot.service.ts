import { Injectable, Logger } from '@nestjs/common';

import { AiAdapter } from '../infra/ai/ai.adapter';
import { AuditService } from '../infra/audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Allowed `eventType` values — must match the `EVENT_TYPES` const on the
 * `CreateEventDraftDto`. We re-declare here rather than import to keep
 * the copilot module from depending on `events/` which depends on us
 * (avoids a cycle when the wizard ships).
 */
const EVENT_TYPES = [
  'wedding',
  'birthday',
  'offsite',
  'hangout',
  'conference',
  'reunion',
  'fundraiser',
  'other',
] as const;
type EventType = (typeof EVENT_TYPES)[number];

const SEGMENT_TYPES = [
  'date_time',
  'venue',
  'budget',
  'agenda',
  'guest_list',
  'roles',
  'theme',
  'travel',
] as const;
type SegmentType = (typeof SEGMENT_TYPES)[number];

export interface CopilotDraftSegment {
  segmentType: SegmentType;
  title: string;
  description: string;
}

export interface CopilotDraft {
  title: string;
  eventType: EventType;
  scheduledDate: string | null; // YYYY-MM-DD or null
  description: string | null;
  segments: CopilotDraftSegment[];
  /** Cents spent on THIS call. Surface to the UI as a tiny badge. */
  costCents: number;
}

const SYSTEM_PROMPT = `You are EPDEMA's event-creation copilot. Given a free-form description of an event someone wants to plan, you output a single JSON object that bootstraps the event in our system.

CRITICAL OUTPUT FORMAT — respond with this JSON shape, no prose, no markdown fences:

{
  "title": "Short event name (≤80 chars). Match the user's tone.",
  "eventType": "wedding" | "birthday" | "offsite" | "hangout" | "conference" | "reunion" | "fundraiser" | "other",
  "scheduledDate": "YYYY-MM-DD" | null,
  "description": "Optional one-paragraph description summarising the event. Keep under 400 chars.",
  "segments": [
    {
      "segmentType": "date_time" | "venue" | "budget" | "agenda" | "guest_list" | "roles" | "theme" | "travel",
      "title": "Short title for this decision (≤80 chars)",
      "description": "1-2 sentences explaining what this segment is for."
    }
  ]
}

RULES:
- Pick the closest \`eventType\` — if none fit, use "other".
- If the user mentions a date range or specific date you can resolve to one day, set \`scheduledDate\`. If they're vague, leave it null.
- Suggest 3 to 7 segments that the planning group will need to decide on. Don't pad — only segments that need real group decisions.
- Each segment's \`segmentType\` must come from the allowed list above. Don't invent new types.
- Order segments logically (when before where before what).
- Match the cultural / geographic context implied (currency, names, venues — assume Nigeria-default unless the user mentions otherwise).
- Don't decide things FOR the group. Suggest segments that frame WHAT to decide, not the decision itself. ("Pick a venue" not "Use venue X").

If the user's description is too short or empty, return { "title": "...", "eventType": "other", "scheduledDate": null, "description": null, "segments": [] } and let the form fill in.`;

@Injectable()
export class CopilotService {
  private readonly logger = new Logger(CopilotService.name);

  constructor(
    private readonly ai: AiAdapter,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * One-shot pre-creation draft. Always uses Opus (per the Phase 6 plan).
   * No event context because none exists yet — budget guard falls through
   * to the per-actor 24h cap.
   */
  async draft(args: { actorUserId: string; description: string }): Promise<CopilotDraft> {
    const rawText = await this.ai.complete({
      context: {
        action: 'ai.copilot_draft',
        eventId: null,
        actorUserId: args.actorUserId,
      },
      model: 'copilot',
      system: [{ text: SYSTEM_PROMPT, cache: true }],
      messages: [{ role: 'user', content: args.description.trim() }],
      maxTokens: 1500,
    });

    const parsed = this.parse(rawText);
    const costCents = await this.lastCallCost(args.actorUserId);

    await this.audit.record({
      action: 'ai.copilot_draft',
      actorUserId: args.actorUserId,
      details: {
        title: parsed.title,
        eventType: parsed.eventType,
        segmentCount: parsed.segments.length,
        promptLength: args.description.length,
      },
    });

    return { ...parsed, costCents };
  }

  // ── helpers ──────────────────────────────────────────────────────────

  /** Defensive JSON parse — strips fences, validates each field. */
  private parse(raw: string): Omit<CopilotDraft, 'costCents'> {
    let trimmed = raw.trim();
    if (trimmed.startsWith('```')) {
      trimmed = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    }
    try {
      const obj = JSON.parse(trimmed) as Partial<CopilotDraft>;
      return {
        title: typeof obj.title === 'string' ? obj.title.slice(0, 120) : 'Untitled event',
        eventType:
          typeof obj.eventType === 'string' && (EVENT_TYPES as readonly string[]).includes(obj.eventType)
            ? (obj.eventType as EventType)
            : 'other',
        scheduledDate: this.parseDate(obj.scheduledDate ?? null),
        description:
          typeof obj.description === 'string' ? obj.description.slice(0, 2000) : null,
        segments: this.parseSegments(obj.segments),
      };
    } catch (err) {
      this.logger.warn(
        `Copilot JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        title: 'Untitled event',
        eventType: 'other',
        scheduledDate: null,
        description: null,
        segments: [],
      };
    }
  }

  /** YYYY-MM-DD only. Anything else → null (the form will prompt the user). */
  private parseDate(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
  }

  private parseSegments(raw: unknown): CopilotDraftSegment[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (s): s is { segmentType: unknown; title: unknown; description: unknown } =>
          typeof s === 'object' && s !== null,
      )
      .map((s) => ({
        segmentType:
          typeof s.segmentType === 'string' &&
          (SEGMENT_TYPES as readonly string[]).includes(s.segmentType)
            ? (s.segmentType as SegmentType)
            : ('agenda' as SegmentType), // best-effort fallback
        title: typeof s.title === 'string' ? s.title.slice(0, 120) : 'Untitled',
        description:
          typeof s.description === 'string' ? s.description.slice(0, 400) : '',
      }))
      .slice(0, 10);
  }

  /**
   * Most recent copilot-draft usage row for this actor — the AiAdapter just
   * wrote one. One small extra query beats threading cost back through the
   * adapter signature.
   */
  private async lastCallCost(actorUserId: string): Promise<number> {
    const row = await this.prisma.aiUsage.findFirst({
      where: { actorUserId, action: 'ai.copilot_draft' },
      orderBy: { createdAt: 'desc' },
      select: { costMinor: true },
    });
    return row?.costMinor ?? 0;
  }
}
