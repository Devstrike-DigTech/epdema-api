import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Public read of an event by its share slug. NO auth required — anyone
 * with the URL can see the published plan.
 *
 * Returns only fields safe for public consumption (title, type, date,
 * locked segment values, creator's display name). Strips: emails,
 * member list, payment info, addon catalog details, objection history,
 * audit log, anything internal.
 */
@Injectable()
export class ShareService {
  constructor(private readonly prisma: PrismaService) {}

  async getBySlug(slug: string) {
    const event = await this.prisma.event.findUnique({
      where: { shareSlug: slug },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            // Phase 7·F — pull the creator's rating fields. Serializer
            // gates on `ratingVisible` + `ratingCount > 0` so a hidden or
            // unreviewed creator's data never leaves this layer.
            profile: {
              select: { ratingAvg: true, ratingCount: true, ratingVisible: true },
            },
          },
        },
        segments: {
          where: { state: 'locked' },
          orderBy: { position: 'asc' },
          select: {
            id: true,
            title: true,
            segmentType: true,
            description: true,
            position: true,
            lockedValue: true,
            lockedAt: true,
          },
        },
      },
    });

    if (!event) throw new NotFoundException('Event not found or no longer published.');

    // Only published / past events are publicly visible.
    if (event.state !== 'published' && event.state !== 'past') {
      throw new NotFoundException('Event not found or no longer published.');
    }

    return event;
  }

  /**
   * Convenience: read brand + features needed for the public-page header
   * theming, in one call. Returns null tier when brand isn't enabled.
   */
  async getPublicBrandBundle(eventId: string) {
    return this.prisma.event.findUnique({
      where: { id: eventId },
      select: { brand: true, features: true },
    });
  }
}
