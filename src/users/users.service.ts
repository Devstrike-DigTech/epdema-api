import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../infra/audit/audit.service';
import type { UpdateProfileDto } from './dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Returns the EPDEMA-side profile row for a Better Auth user.
   * Creates it on first access so we can rely on its presence elsewhere.
   */
  async findOrCreateProfile(userId: string) {
    return this.prisma.userProfile.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
  }

  /**
   * Phase 7·F — partial update. Upserts so the row is guaranteed to exist
   * after the call, even if the user has never hit `/users/me` before. Only
   * fields explicitly present in `patch` mutate; undefined fields are left
   * alone (no "reset everything to null on partial update" footgun).
   *
   * Records `profile.updated` with the diff'd keys (not values) so the audit
   * log doesn't accidentally store PII like phone numbers in plaintext.
   */
  async updateProfile(userId: string, patch: UpdateProfileDto) {
    const updateData: Record<string, unknown> = {};
    if (patch.ratingVisible !== undefined) updateData.ratingVisible = patch.ratingVisible;
    if (patch.displayName !== undefined) updateData.displayName = patch.displayName;
    if (patch.phone !== undefined) updateData.phone = patch.phone;
    if (patch.city !== undefined) updateData.city = patch.city;

    const updated = await this.prisma.userProfile.upsert({
      where: { userId },
      update: updateData,
      create: { userId, ...updateData },
    });
    await this.audit.record({
      action: 'profile.updated',
      actorUserId: userId,
      details: { changedKeys: Object.keys(updateData) },
    });
    return updated;
  }
}
