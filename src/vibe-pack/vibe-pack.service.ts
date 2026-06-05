import {
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

export interface VibePack {
  themeName: string;
  /** Hex strings, exactly 3, including the leading `#`. */
  palette: string[];
  decorations: string[];
  music: string[];
  emoji: string;
  costCents: number;
  /** Was the event.brand also auto-updated with this palette? */
  brandApplied: boolean;
}

const SYSTEM_PROMPT = `You are EPDEMA's vibe-pack copilot. Given an event's context, you propose ONE coherent visual + audio mood for it: theme name, color palette, decoration ideas, music suggestions, and a single emoji.

CRITICAL OUTPUT FORMAT — respond with this JSON shape, nothing else, no prose, no markdown fences:

{
  "themeName": "Short evocative name (≤40 chars). Concrete imagery beats abstract adjectives.",
  "palette": ["#RRGGBB", "#RRGGBB", "#RRGGBB"],
  "decorations": ["1-2 sentence decoration ideas", "..."],
  "music": ["Genre / vibe + 1 example artist or track", "..."],
  "emoji": "ONE emoji that captures the vibe."
}

RULES:
- Exactly 3 colors in the palette. The first MUST be the dominant brand color; the second the accent; the third a deep text color readable on the first. Use proper hex (#RRGGBB) — no shorthand.
- 4 to 6 decoration ideas. Concrete, achievable on a modest budget unless the event description suggests otherwise.
- 3 to 5 music suggestions. Match the event type's energy.
- Match the cultural / geographic context implied by the event. Default to Nigerian sensibilities unless the event mentions otherwise.
- ONE coherent theme — don't propose three competing vibes. Pick one and commit.

Output the JSON now.`;

@Injectable()
export class VibePackService {
  private readonly logger = new Logger(VibePackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly members: MembersService,
    private readonly ai: AiAdapter,
    private readonly audit: AuditService,
  ) {}

  /**
   * One-shot vibe pack — the add-on costs ₦1,500 and grants exactly one
   * successful generation. Re-rolls require re-purchasing the add-on.
   *
   * Theme colors auto-write to `event.brand` if the event is on a tier that
   * doesn't already allow custom branding — the add-on grants that side-effect
   * for free (otherwise a Gathering-tier event would pay for a vibe pack and
   * have nowhere to surface the colors).
   */
  async generate(args: { eventId: string; actorUserId: string }): Promise<VibePack> {
    await this.members.assertAdminOrThrow(args.actorUserId, args.eventId);

    const event = await this.prisma.event.findUnique({
      where: { id: args.eventId },
      select: {
        title: true,
        eventType: true,
        scheduledDate: true,
        description: true,
        features: true,
        brand: true,
      },
    });
    if (!event) throw new NotFoundException('Event not found.');

    const f = (event.features ?? {}) as { ai?: { vibePack?: boolean } };
    if (f.ai?.vibePack !== true) {
      throw new ForbiddenException(
        'AI vibe pack is a one-shot add-on (₦1,500). Purchase it from the event settings, then come back.',
      );
    }

    // One-shot enforcement — refuse if any successful prior call landed.
    // The cost row writes only on success (failed rows have model `failed:*`
    // and zero cost), so checking `costMinor > 0` weeds those out.
    const priorSuccess = await this.prisma.aiUsage.findFirst({
      where: { eventId: args.eventId, action: 'ai.vibe_pack', costMinor: { gt: 0 } },
      select: { id: true, createdAt: true },
    });
    // Dev-fallback writes 0¢ rows too — count those when no real cost was paid.
    const priorAny = await this.prisma.aiUsage.findFirst({
      where: { eventId: args.eventId, action: 'ai.vibe_pack' },
      select: { id: true, createdAt: true, model: true },
    });
    if (
      priorSuccess ||
      (priorAny && !priorAny.model.startsWith('failed:'))
    ) {
      throw new ConflictException(
        "This event's vibe pack has already been generated. Purchase the add-on again to re-roll.",
      );
    }

    const userMessage = this.buildUserMessage(event);

    const rawText = await this.ai.complete({
      context: {
        action: 'ai.vibe_pack',
        eventId: args.eventId,
        actorUserId: args.actorUserId,
      },
      system: [{ text: SYSTEM_PROMPT, cache: true }],
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 800,
    });

    const parsed = this.parse(rawText);
    if (!parsed) {
      throw new Error(
        'Vibe pack generation failed to produce usable output. Try again — your purchase is not consumed.',
      );
    }

    // Auto-apply theme colors to event.brand. Preserve any logo/cover URLs
    // already set; only touch the three color slots.
    const currentBrand = (event.brand ?? {}) as {
      color?: string | null;
      accentColor?: string | null;
      textColor?: string | null;
      logoKey?: string | null;
      coverImageKey?: string | null;
    };
    const nextBrand = {
      ...currentBrand,
      color: parsed.palette[0] ?? null,
      accentColor: parsed.palette[1] ?? null,
      textColor: parsed.palette[2] ?? null,
    };
    await this.prisma.event.update({
      where: { id: args.eventId },
      data: { brand: nextBrand },
    });

    const costCents = await this.lastCallCost(args.eventId);

    await this.audit.record({
      action: 'ai.vibe_pack',
      actorUserId: args.actorUserId,
      eventId: args.eventId,
      details: {
        themeName: parsed.themeName,
        palette: parsed.palette,
        decorationCount: parsed.decorations.length,
        musicCount: parsed.music.length,
      },
    });

    return { ...parsed, costCents, brandApplied: true };
  }

  // ── helpers ──────────────────────────────────────────────────────────

  private buildUserMessage(event: {
    title: string;
    eventType: string;
    scheduledDate: Date | null;
    description: string | null;
  }): string {
    return `Event: "${event.title}" (${event.eventType})
${event.scheduledDate ? `Date: ${event.scheduledDate.toISOString().slice(0, 10)}` : 'Date: not yet decided'}
${event.description ? `Notes: ${event.description}` : ''}

Generate ONE coherent vibe pack for this event. Return the JSON now.`;
  }

  private parse(raw: string): Omit<VibePack, 'costCents' | 'brandApplied'> | null {
    let trimmed = raw.trim();
    if (trimmed.startsWith('```')) {
      trimmed = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    }
    try {
      const obj = JSON.parse(trimmed) as Partial<VibePack>;
      if (
        typeof obj.themeName !== 'string' ||
        !Array.isArray(obj.palette) ||
        obj.palette.length < 3 ||
        !Array.isArray(obj.decorations) ||
        !Array.isArray(obj.music) ||
        typeof obj.emoji !== 'string'
      ) {
        return null;
      }
      const palette = obj.palette
        .filter((h): h is string => typeof h === 'string' && /^#[0-9A-Fa-f]{6}$/.test(h))
        .slice(0, 3);
      if (palette.length < 3) return null;
      return {
        themeName: obj.themeName.slice(0, 60),
        palette,
        decorations: obj.decorations.filter((s): s is string => typeof s === 'string').slice(0, 8),
        music: obj.music.filter((s): s is string => typeof s === 'string').slice(0, 6),
        emoji: obj.emoji.slice(0, 4),
      };
    } catch (err) {
      this.logger.warn(
        `Vibe-pack JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private async lastCallCost(eventId: string): Promise<number> {
    const row = await this.prisma.aiUsage.findFirst({
      where: { eventId, action: 'ai.vibe_pack' },
      orderBy: { createdAt: 'desc' },
      select: { costMinor: true },
    });
    return row?.costMinor ?? 0;
  }
}
