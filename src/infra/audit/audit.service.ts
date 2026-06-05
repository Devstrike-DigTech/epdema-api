import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditEntry {
  /** Stable action identifier. Convention: `noun.verb` e.g. `payment.success`, `event.provisioned`. */
  action: string;
  actorUserId?: string | null;
  eventId?: string | null;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
  /** When inside a transaction, pass the tx client to ensure atomicity with business state. */
  tx?: Prisma.TransactionClient;
}

/**
 * Append-only audit logger. Never updates or deletes rows.
 * Failure to write an audit entry must NOT break the business operation;
 * we log the error and continue. Use `tx` to make audit + state change atomic
 * when correctness matters (refunds, payment success, segment locks).
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    const client = entry.tx ?? this.prisma;
    try {
      await client.auditLog.create({
        data: {
          action: entry.action,
          actorUserId: entry.actorUserId ?? null,
          eventId: entry.eventId ?? null,
          details: (entry.details ?? {}) as Prisma.InputJsonValue,
          ipAddress: entry.ipAddress ?? null,
          userAgent: entry.userAgent ?? null,
        },
      });
    } catch (err) {
      // Don't break the business op on audit failure, but make it loud.
      this.logger.error(
        `Audit write failed for action=${entry.action} event=${entry.eventId ?? '-'}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
