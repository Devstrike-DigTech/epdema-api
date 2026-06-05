import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { AiAdapter } from '../infra/ai/ai.adapter';
import { AuditService } from '../infra/audit/audit.service';
import { MembersService } from '../members/members.service';
import { PrismaService } from '../prisma/prisma.service';

export type WarningSeverity = 'info' | 'warning' | 'critical';

export interface HolidayWarning {
  severity: WarningSeverity;
  title: string;
  detail: string;
}

export interface HolidayScanResult {
  warnings: HolidayWarning[];
  scannedDate: string;
  costCents: number;
}

const SYSTEM_PROMPT = `You are EPDEMA's holiday & conflict scanner. Given an event date and a brief description of the event, you flag potential scheduling concerns the organizer should know about BEFORE they lock the date.

CRITICAL OUTPUT FORMAT — respond with this JSON shape, nothing else, no prose, no fences:

{
  "warnings": [
    {
      "severity": "info" | "warning" | "critical",
      "title": "Short headline (≤60 chars)",
      "detail": "1-2 sentence explanation including the concrete conflict and what to consider."
    }
  ]
}

WHAT TO SURFACE:
- Public holidays in Nigeria (or the locale the event implies) ON or NEAR the event date.
- Major religious observances (Eid, Christmas, Easter, Ramadan dates).
- Predictable weather concerns (rainy season for outdoor events; harmattan/dust for January-February).
- Major competing events in big Nigerian cities (marathons, festivals, popular wedding seasons that affect vendor pricing).
- Day-of-week notes ONLY when a strong cultural pattern applies (e.g. Friday-Saturday weddings are heavily booked in Lagos).

WHAT NOT TO DO:
- Don't list every minor holiday. Aim for 0-5 warnings — quality over quantity.
- Don't invent events you're not confident about. If you don't know, omit it.
- Don't tell the organizer to "consider another date" — leave the decision to them.
- Severity rules: "critical" = certain conflict (public holiday, religious observance); "warning" = likely friction (rainy season, vendor pricing); "info" = worth-knowing context (day-of-week patterns).

If the date is fine and you have nothing useful to flag, return { "warnings": [] }.`;

@Injectable()
export class HolidayScannerService {
  private readonly logger = new Logger(HolidayScannerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly members: MembersService,
    private readonly ai: AiAdapter,
    private readonly audit: AuditService,
  ) {}

  /**
   * One-shot per (eventId, scheduledDate). Re-running with a *changed* date
   * is allowed — common during planning. We compare the last successful
   * audit log entry's `scannedDate` against the current scheduledDate.
   */
  async scan(args: { eventId: string; actorUserId: string }): Promise<HolidayScanResult> {
    await this.members.assertAdminOrThrow(args.actorUserId, args.eventId);

    const event = await this.prisma.event.findUnique({
      where: { id: args.eventId },
      select: {
        title: true,
        eventType: true,
        scheduledDate: true,
        description: true,
        features: true,
      },
    });
    if (!event) throw new NotFoundException('Event not found.');

    const f = (event.features ?? {}) as { ai?: { holidayScanner?: boolean } };
    if (f.ai?.holidayScanner !== true) {
      throw new ForbiddenException(
        'Holiday & conflict scanner is a one-shot add-on (₦900). Purchase it from the event settings.',
      );
    }
    if (!event.scheduledDate) {
      throw new BadRequestException(
        'Set a scheduled date first — the scanner needs to know when to check.',
      );
    }
    const scheduledDateStr = event.scheduledDate.toISOString().slice(0, 10);

    // One-shot per date. Find the most recent successful scan; if its
    // `scannedDate` matches the current event date, refuse (same date already
    // covered). If the date changed, allow re-scan.
    const lastScan = await this.prisma.auditLog.findFirst({
      where: { eventId: args.eventId, action: 'ai.holiday_scanner' },
      orderBy: { createdAt: 'desc' },
      select: { details: true },
    });
    if (lastScan) {
      const lastDate = (lastScan.details as { scannedDate?: string } | null)?.scannedDate;
      if (lastDate === scheduledDateStr) {
        throw new ConflictException(
          `This event's holiday scan has already been generated for ${scheduledDateStr}. Change the date or buy the add-on again to re-scan.`,
        );
      }
    }

    const userMessage = `Event: "${event.title}" (${event.eventType})
Date: ${scheduledDateStr}
${event.description ? `Notes: ${event.description}` : ''}

Return the JSON now.`;

    const rawText = await this.ai.complete({
      context: {
        action: 'ai.holiday_scanner',
        eventId: args.eventId,
        actorUserId: args.actorUserId,
      },
      system: [{ text: SYSTEM_PROMPT, cache: true }],
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 800,
    });

    const warnings = this.parse(rawText);
    const costCents = await this.lastCallCost(args.eventId);

    // Persist the full warnings list in the audit row so `latest()` can
    // surface them on subsequent loads of the event page without a re-scan.
    // Audit details is `Json` — small per-row payload (4-5 warnings × ~200
    // bytes = ~1 KB), no migration needed.
    await this.audit.record({
      action: 'ai.holiday_scanner',
      actorUserId: args.actorUserId,
      eventId: args.eventId,
      details: {
        scannedDate: scheduledDateStr,
        warnings,
        warningCount: warnings.length,
        criticalCount: warnings.filter((w) => w.severity === 'critical').length,
      },
    });

    return { warnings, scannedDate: scheduledDateStr, costCents };
  }

  /**
   * Public read for the strip on the event detail page. No new Claude call —
   * just surfaces the latest cached scan from audit_log + ai_usage. Returns
   * null when nothing's been scanned yet.
   */
  async latest(eventId: string, actorUserId: string): Promise<HolidayScanResult | null> {
    await this.members.assertAdminOrThrow(actorUserId, eventId);

    const row = await this.prisma.auditLog.findFirst({
      where: { eventId, action: 'ai.holiday_scanner' },
      orderBy: { createdAt: 'desc' },
      select: { details: true, createdAt: true },
    });
    if (!row) return null;

    const details = row.details as {
      scannedDate?: string;
      warnings?: HolidayWarning[];
    } | null;
    return {
      warnings: Array.isArray(details?.warnings) ? details!.warnings : [],
      scannedDate: details?.scannedDate ?? '',
      costCents: 0,
    };
  }

  // ── helpers ──────────────────────────────────────────────────────────

  private parse(raw: string): HolidayWarning[] {
    let trimmed = raw.trim();
    if (trimmed.startsWith('```')) {
      trimmed = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    }
    const SEVERITIES: WarningSeverity[] = ['info', 'warning', 'critical'];
    try {
      const obj = JSON.parse(trimmed) as { warnings?: unknown[] };
      if (!Array.isArray(obj.warnings)) return [];
      return obj.warnings
        .filter(
          (w): w is { severity: unknown; title: unknown; detail: unknown } =>
            typeof w === 'object' && w !== null,
        )
        .map((w) => ({
          severity:
            typeof w.severity === 'string' && (SEVERITIES as readonly string[]).includes(w.severity)
              ? (w.severity as WarningSeverity)
              : ('info' as WarningSeverity),
          title: typeof w.title === 'string' ? w.title.slice(0, 80) : 'Untitled',
          detail: typeof w.detail === 'string' ? w.detail.slice(0, 400) : '',
        }))
        .slice(0, 8);
    } catch (err) {
      this.logger.warn(
        `Holiday-scan JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  private async lastCallCost(eventId: string): Promise<number> {
    const row = await this.prisma.aiUsage.findFirst({
      where: { eventId, action: 'ai.holiday_scanner' },
      orderBy: { createdAt: 'desc' },
      select: { costMinor: true },
    });
    return row?.costMinor ?? 0;
  }
}
