import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, QueueEvents } from 'bullmq';
import Redis from 'ioredis';

import { QUEUE_NAME } from './queue.constants';

/**
 * Thin Nest wrapper around the single BullMQ `Queue` we use for everything.
 *
 * Why not reuse `RedisService.client`?
 * BullMQ wants a dedicated `ioredis` connection with `maxRetriesPerRequest: null`
 * + `enableReadyCheck: false` so its blocking commands can survive Redis hiccups
 * without spamming retries on every other operation that shares the connection.
 * So we open our own.
 *
 * QueueEvents is exposed so RemindersService can subscribe to `completed` /
 * `failed` and reflect job outcomes back into the ScheduledReminder table.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private _queue!: Queue;
  private _events!: QueueEvents;
  private _connection!: Redis;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const url = this.config.getOrThrow<string>('REDIS_URL');
    this._connection = new Redis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    this._queue = new Queue(QUEUE_NAME, { connection: this._connection });
    this._events = new QueueEvents(QUEUE_NAME, { connection: this._connection.duplicate() });
    this.logger.log(`Queue "${QUEUE_NAME}" ready`);
  }

  async onModuleDestroy(): Promise<void> {
    await this._queue?.close();
    await this._events?.close();
    await this._connection?.quit();
  }

  /**
   * The main producer handle. Adds jobs, removes by id, etc.
   * Consumers (workers) are created in the worker bootstrap, not here.
   */
  get queue(): Queue {
    return this._queue;
  }

  /**
   * Read-only event stream. Use this to .on('completed' | 'failed' | …) without
   * accidentally polling the queue.
   */
  get events(): QueueEvents {
    return this._events;
  }
}
