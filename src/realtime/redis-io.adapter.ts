import { IoAdapter } from '@nestjs/platform-socket.io';
import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { createAdapter } from '@socket.io/redis-adapter';
import { ServerOptions } from 'socket.io';
import Redis from 'ioredis';

/**
 * Socket.IO adapter that fans events out via Redis pub/sub so multiple API
 * instances share the same broadcast space.
 *
 * Without this, an event emitted on instance A wouldn't reach a client
 * connected to instance B. Required as soon as Railway scales the API beyond
 * one replica (Tier 2+); harmless in dev with a single instance.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapter?: ReturnType<typeof createAdapter>;
  private pubClient?: Redis;
  private subClient?: Redis;

  constructor(
    app: INestApplication,
    private readonly redisUrl: string,
  ) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    // ioredis options match the existing RedisService — keep them in sync.
    this.pubClient = new Redis(this.redisUrl, { lazyConnect: true });
    this.subClient = this.pubClient.duplicate();
    await Promise.all([this.pubClient.connect(), this.subClient.connect()]);
    this.adapter = createAdapter(this.pubClient, this.subClient);
    this.logger.log('Socket.IO Redis adapter connected');
  }

  async disconnectFromRedis(): Promise<void> {
    await Promise.all([this.pubClient?.quit(), this.subClient?.quit()]);
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    const server = super.createIOServer(port, options) as {
      adapter: (...args: unknown[]) => unknown;
    };
    if (this.adapter) {
      server.adapter(this.adapter);
    }
    return server;
  }
}
