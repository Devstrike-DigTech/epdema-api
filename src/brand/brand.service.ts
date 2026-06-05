import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { MembersService } from '../members/members.service';
import { AuditService } from '../infra/audit/audit.service';
import { StorageAdapter } from '../infra/storage/storage.adapter';
import { BrandDto, BrandStored, readBrand, serializeBrand } from './serializer';

/**
 * Image kinds we accept for brand assets. Each entry caps file size + allowed
 * mime types so a malicious upload can't fill the disk or hide HTML in an SVG.
 */
const ASSET_LIMITS = {
  logo: {
    maxBytes: 2 * 1024 * 1024, // 2 MB
    allow: new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']),
  },
  cover: {
    maxBytes: 6 * 1024 * 1024, // 6 MB
    allow: new Set(['image/png', 'image/jpeg', 'image/webp']),
  },
} as const;

type AssetKind = keyof typeof ASSET_LIMITS;

@Injectable()
export class BrandService {
  private readonly logger = new Logger(BrandService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly members: MembersService,
    private readonly audit: AuditService,
    private readonly storage: StorageAdapter,
  ) {}

  // ── Tier gate ─────────────────────────────────────────────────────────

  /**
   * Production tier and up grant `branding.customSharePage`. Anything below
   * gets a 403 so the UI can show an upgrade nudge.
   */
  private assertBrandingAllowed(features: unknown): void {
    const f = (features ?? {}) as { branding?: { customSharePage?: boolean } };
    if (f.branding?.customSharePage !== true) {
      throw new ForbiddenException(
        'Custom branding is a Production-tier feature. Upgrade to enable.',
      );
    }
  }

  // ── Read ──────────────────────────────────────────────────────────────

  async getForAdmin(userId: string, eventId: string): Promise<BrandDto> {
    await this.members.assertAdminOrThrow(userId, eventId);
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { brand: true, features: true },
    });
    if (!event) throw new NotFoundException('Event not found.');
    // Read is allowed regardless of tier — useful for showing "you used to have
    // branding configured" when a tier downgrades. Mutations check the tier.
    return serializeBrand(event.brand, this.storage);
  }

  // ── Update colors ─────────────────────────────────────────────────────

  async updateColors(
    userId: string,
    eventId: string,
    patch: { color?: string | null; accentColor?: string | null; textColor?: string | null },
  ): Promise<BrandDto> {
    await this.members.assertAdminOrThrow(userId, eventId);
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { brand: true, features: true },
    });
    if (!event) throw new NotFoundException('Event not found.');
    this.assertBrandingAllowed(event.features);

    const current = readBrand(event.brand);
    const next: BrandStored = {
      ...current,
      ...(patch.color !== undefined && { color: patch.color }),
      ...(patch.accentColor !== undefined && { accentColor: patch.accentColor }),
      ...(patch.textColor !== undefined && { textColor: patch.textColor }),
    };

    const saved = await this.prisma.event.update({
      where: { id: eventId },
      data: { brand: pruneNulls(next) as object },
      select: { brand: true },
    });

    await this.audit.record({
      action: 'event.brand_colors_updated',
      actorUserId: userId,
      eventId,
      details: { color: next.color, accentColor: next.accentColor, textColor: next.textColor },
    });

    return serializeBrand(saved.brand, this.storage);
  }

  // ── Upload asset (logo | cover) ───────────────────────────────────────

  async uploadAsset(
    userId: string,
    eventId: string,
    kind: AssetKind,
    file: { buffer: Buffer; mimetype: string; size: number; originalname: string },
  ): Promise<BrandDto> {
    await this.members.assertAdminOrThrow(userId, eventId);
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { brand: true, features: true },
    });
    if (!event) throw new NotFoundException('Event not found.');
    this.assertBrandingAllowed(event.features);

    const limit = ASSET_LIMITS[kind];
    if (!file.buffer || file.size === 0) {
      throw new BadRequestException('Empty file.');
    }
    if (file.size > limit.maxBytes) {
      throw new BadRequestException(
        `File too large for ${kind} (max ${(limit.maxBytes / 1024 / 1024).toFixed(0)} MB).`,
      );
    }
    if (!limit.allow.has(file.mimetype)) {
      throw new BadRequestException(
        `Unsupported ${kind} type "${file.mimetype}". Allowed: ${[...limit.allow].join(', ')}.`,
      );
    }

    // Upload first — if storage write fails, we don't want to point the DB at
    // a ghost key. Use UUIDs in the filename so cache busting is automatic on
    // re-upload (each upload yields a distinct URL).
    const ext = mimeExtension(file.mimetype);
    const newKey = `events/${eventId}/${kind}-${randomUUID()}${ext}`;
    await this.storage.upload({
      key: newKey,
      body: file.buffer,
      contentType: file.mimetype,
    });

    // Swap the key, persist, then delete the old asset (best-effort).
    const current = readBrand(event.brand);
    const previousKey = kind === 'logo' ? current.logoKey : current.coverImageKey;
    const next: BrandStored = {
      ...current,
      [kind === 'logo' ? 'logoKey' : 'coverImageKey']: newKey,
    };
    const saved = await this.prisma.event.update({
      where: { id: eventId },
      data: { brand: pruneNulls(next) as object },
      select: { brand: true },
    });

    if (previousKey) {
      await this.storage.delete(previousKey).catch((err) =>
        this.logger.warn(
          `Failed to delete previous ${kind} for event ${eventId} (key=${previousKey}): ${
            err instanceof Error ? err.message : err
          }`,
        ),
      );
    }

    await this.audit.record({
      action: kind === 'logo' ? 'event.brand_logo_uploaded' : 'event.brand_cover_uploaded',
      actorUserId: userId,
      eventId,
      details: { key: newKey, size: file.size, type: file.mimetype },
    });

    return serializeBrand(saved.brand, this.storage);
  }

  // ── Remove asset ──────────────────────────────────────────────────────

  async removeAsset(
    userId: string,
    eventId: string,
    kind: AssetKind,
  ): Promise<BrandDto> {
    await this.members.assertAdminOrThrow(userId, eventId);
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { brand: true, features: true },
    });
    if (!event) throw new NotFoundException('Event not found.');
    // Allow removal even if tier was downgraded — clearing assets shouldn't
    // be a paid feature.

    const current = readBrand(event.brand);
    const oldKey = kind === 'logo' ? current.logoKey : current.coverImageKey;
    if (!oldKey) {
      return serializeBrand(current, this.storage);
    }

    const next: BrandStored = {
      ...current,
      [kind === 'logo' ? 'logoKey' : 'coverImageKey']: null,
    };
    const saved = await this.prisma.event.update({
      where: { id: eventId },
      data: { brand: pruneNulls(next) as object },
      select: { brand: true },
    });

    await this.storage.delete(oldKey).catch((err) =>
      this.logger.warn(
        `Failed to delete ${kind} on remove for event ${eventId} (key=${oldKey}): ${
          err instanceof Error ? err.message : err
        }`,
      ),
    );

    await this.audit.record({
      action: kind === 'logo' ? 'event.brand_logo_removed' : 'event.brand_cover_removed',
      actorUserId: userId,
      eventId,
    });

    return serializeBrand(saved.brand, this.storage);
  }

  // ── Public read (used by ShareService / RSVP controller) ──────────────

  /**
   * Returns the public brand or null when the event's tier doesn't permit
   * branding. Public consumers should fall back to default chrome when null.
   */
  publicBrand(features: unknown, raw: unknown): BrandDto | null {
    const f = (features ?? {}) as { branding?: { customSharePage?: boolean } };
    if (f.branding?.customSharePage !== true) return null;
    const dto = serializeBrand(raw, this.storage);
    // If everything is null we still gate at null so the client doesn't render
    // an empty branded shell with no color or logo.
    const hasAny =
      dto.color || dto.accentColor || dto.textColor || dto.logoUrl || dto.coverImageUrl;
    return hasAny ? dto : null;
  }
}

function pruneNulls(obj: BrandStored): BrandStored {
  const out: BrandStored = {};
  (Object.keys(obj) as (keyof BrandStored)[]).forEach((k) => {
    const v = obj[k];
    if (v !== null && v !== undefined) out[k] = v as never;
  });
  return out;
}

function mimeExtension(mime: string): string {
  switch (mime) {
    case 'image/png':
      return '.png';
    case 'image/jpeg':
      return '.jpg';
    case 'image/webp':
      return '.webp';
    case 'image/svg+xml':
      return '.svg';
    default:
      return '';
  }
}
