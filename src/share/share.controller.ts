import { Controller, Get, Header, Param, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';

import { Public } from '../auth/public.decorator';
import { ShareService } from './share.service';
import { serializePublicEvent } from './share.serializer';
import { extractVenueFromSegments, generateIcsEvent } from './ics-generator';
import { BrandService } from '../brand/brand.service';
import { PublicShareResponseDto } from './share.responses';

/**
 * Public-facing share endpoints. NO auth required — anyone with the slug
 * can read the published plan or download the .ics file.
 *
 * Path-param shorthand: the `:slug` segment is NOT a UUID — it's a
 * lowercase-letters/digits/single-hyphens slug (3-64 chars). The
 * `@ApiParam` calls below intentionally omit `format` so codegen types
 * it as a plain string.
 */
const SLUG_PARAM = {
  name: 'slug',
  example: 'tunde-bola',
  description: 'Public share slug (lowercase letters/digits/single hyphens, 3-64 chars).',
} as const;

@ApiTags('share')
@Controller('share')
export class ShareController {
  private readonly webOrigin: string;

  constructor(
    private readonly share: ShareService,
    private readonly brand: BrandService,
    config: ConfigService,
  ) {
    this.webOrigin = config.getOrThrow<string>('WEB_ORIGIN');
  }

  @Public()
  // Phase 5.7·F — slug-enumeration mitigation. 10/10s burst plus the
  // baseline 60/min lets a real user browse a friend's plan plus the
  // calendar download without tripping anything, but rules out brute-force
  // scraping for valid share slugs.
  @Throttle({ short: { ttl: 10_000, limit: 10 } })
  @Get(':slug')
  @ApiOperation({
    operationId: 'share_getBySlug',
    summary: 'Get the public share page for an event',
  })
  @ApiParam(SLUG_PARAM)
  @ApiOkResponse({
    type: PublicShareResponseDto,
    description:
      'Public event details — title, date, decided segments, creator name, ' +
      'and (Production+ tier) the event brand. No PII.',
  })
  async get(@Param('slug') slug: string) {
    const event = await this.share.getBySlug(slug);
    const base = serializePublicEvent(event);
    // brand may be null when the event tier doesn't grant custom branding,
    // or when the organizer hasn't configured anything yet.
    return {
      ...base,
      brand: this.brand.publicBrand(event.features, event.brand),
    };
  }

  @Public()
  @Get(':slug/calendar.ics')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @ApiOperation({
    operationId: 'share_downloadCalendar',
    summary: 'Download the event as an .ics calendar file',
  })
  @ApiParam(SLUG_PARAM)
  @ApiProduces('text/calendar; charset=utf-8')
  @ApiResponse({
    status: 200,
    description:
      'iCalendar (RFC 5545) file with a single VEVENT for the scheduled date. ' +
      'Returns 404 (text/plain) when the event has no scheduled date yet.',
    content: { 'text/calendar': { schema: { type: 'string' } } },
  })
  async calendar(@Param('slug') slug: string, @Res() res: Response): Promise<void> {
    const event = await this.share.getBySlug(slug);
    if (!event.scheduledDate) {
      res.status(404).type('text/plain').send('Event has no scheduled date.');
      return;
    }

    const venue = extractVenueFromSegments(
      event.segments.map((s) => ({
        segmentType: s.segmentType,
        title: s.title,
        lockedValue: s.lockedValue,
      })),
    );

    const ics = generateIcsEvent({
      uid: event.id,
      date: event.scheduledDate.toISOString().slice(0, 10),
      title: event.title,
      description: event.description ?? undefined,
      location: venue,
      url: `${this.webOrigin}/share/${event.shareSlug}`,
      stamp: event.publishedAt ?? new Date(),
      lastModified: event.updatedAt,
    });

    const filename = `${event.title.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60) || 'event'}.ics`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(ics);
  }
}
