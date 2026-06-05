import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

import { QueueService } from '../infra/queue/queue.service';
import { JOB_NAMES, jobIdFor } from '../infra/queue/queue.constants';

/**
 * Phase 7·D — boots the repeatable scan job exactly once when the API
 * container starts. The job itself is consumed by `PastStateProcessor`
 * in the worker container; this service is only the producer side.
 *
 * Why on the API container and not the worker?
 *   BullMQ's `repeat` metadata lives in Redis, so it survives a worker
 *   restart and is idempotent on re-add (same singleton id + same pattern
 *   = no duplicates). Adding it from the API container means every API
 *   pod re-asserts the schedule on boot — harmless thanks to the
 *   singleton id, and ensures the schedule never goes missing if the
 *   worker is briefly absent.
 *
 * Cadence: every hour, on the hour. The scan is cheap (one indexed
 * SELECT + N small updates) and we don't need finer granularity — even
 * the most-late event flips within an hour of midnight UTC on the next
 * day, which is fine for review windows.
 */
@Injectable()
export class PastStateSchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PastStateSchedulerService.name);

  constructor(private readonly queue: QueueService) {}

  async onApplicationBootstrap(): Promise<void> {
    const jobId = jobIdFor.pastStateScan();
    // `every: ms` is BullMQ's simple repeat — under the hood it schedules the
    // next run after each completion. `jobId` keeps multiple API pods from
    // adding duplicate repeatables; same id + same pattern = a no-op.
    await this.queue.queue.add(
      JOB_NAMES.pastStateScan,
      { kickedAt: 'boot' },
      {
        jobId,
        repeat: { every: 60 * 60 * 1000 }, // 1 hour
        // First run starts ~1 minute after boot so the API isn't hammered
        // mid-startup. Subsequent runs use the `every` cadence.
        delay: 60_000,
        removeOnComplete: true,
        removeOnFail: 100, // keep 100 failed for diagnostics
      },
    );
    this.logger.log(
      `Past-state scan scheduled every 1h (singleton job id "${jobId}")`,
    );
  }
}
