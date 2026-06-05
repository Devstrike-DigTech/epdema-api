import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private _client!: Redis;
  private _pub!: Redis;
  private _sub!: Redis;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const url = this.config.getOrThrow<string>('REDIS_URL');
    this._client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 3 });
    this._pub = new Redis(url, { lazyConnect: true });
    this._sub = new Redis(url, { lazyConnect: true });
    await Promise.all([this._client.connect(), this._pub.connect(), this._sub.connect()]);
    this.logger.log('Connected to Redis');
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this._client?.quit(), this._pub?.quit(), this._sub?.quit()]);
  }

  /** General-purpose Redis client for cache, rate-limit counters, presence, etc. */
  get client(): Redis {
    return this._client;
  }

  /** Publisher half of the Socket.IO Redis adapter pair. */
  get pub(): Redis {
    return this._pub;
  }

  /** Subscriber half of the Socket.IO Redis adapter pair. */
  get sub(): Redis {
    return this._sub;
  }
}
