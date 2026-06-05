import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TiersService {
  constructor(private readonly prisma: PrismaService) {}

  /** All active tiers, cheapest first. */
  listTiers() {
    return this.prisma.tier.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /** All active add-ons, alphabetical by displayName. */
  listAddons() {
    return this.prisma.addon.findMany({
      where: { active: true },
      orderBy: { displayName: 'asc' },
    });
  }

  async getTierOrThrow(slug: string) {
    const tier = await this.prisma.tier.findUnique({ where: { slug } });
    if (!tier || !tier.active) {
      throw new NotFoundException(`Unknown or inactive tier: ${slug}`);
    }
    return tier;
  }

  async getAddonsOrThrow(slugs: string[]) {
    if (slugs.length === 0) return [];
    const addons = await this.prisma.addon.findMany({
      where: { slug: { in: slugs }, active: true },
    });
    if (addons.length !== slugs.length) {
      const found = new Set(addons.map((a) => a.slug));
      const missing = slugs.filter((s) => !found.has(s));
      throw new NotFoundException(`Unknown or inactive add-ons: ${missing.join(', ')}`);
    }
    return addons;
  }
}
