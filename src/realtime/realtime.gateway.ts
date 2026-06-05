import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fromNodeHeaders } from 'better-auth/node';
import { randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';

import { auth } from '../auth/better-auth.config';
import { PrismaService } from '../prisma/prisma.service';

interface AuthedSocketData {
  userId: string;
  joinedEventIds: Set<string>;
}

type AuthedSocket = Socket & { data: AuthedSocketData };

interface RoomJoinPayload {
  eventId: string;
}

/**
 * Realtime gateway for the planning room.
 *
 * Connect-time auth: every Socket reads the Better Auth session via the
 * handshake headers. No session = disconnect. Cookies travel automatically
 * with `withCredentials: true` on the client; Flutter will use bearer.
 *
 * Room model: one room per event, named `room:<eventId>`. Clients call
 * `room:join` after connect; the gateway authorizes against the event's
 * creator (Phase 4 will broaden this to planning_members).
 *
 * Broadcast: services inject this gateway and call `broadcastSegmentChanged`
 * AFTER their DB transaction commits — never inside it (rollback after emit
 * would leak phantom state to clients).
 *
 * The path `/realtime` matches docs/04 §8. Default Socket.IO path is
 * `/socket.io`; we override here and on the client.
 */
@WebSocketGateway({
  path: '/realtime',
  cors: {
    // CORS for WebSocket upgrade. Mirrors the HTTP CORS in main.ts.
    credentials: true,
    origin: (origin: string | undefined, cb: (err: Error | null, ok?: boolean) => void) => {
      if (!origin) return cb(null, true);
      const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
      const ok = origin === webOrigin || /\.vercel\.app$/.test(origin);
      cb(null, ok);
    },
  },
})
@Injectable()
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // ────────────────────────────────────────────────────────────
  // Auth — registered as Socket.IO middleware via afterInit.
  //
  // Why middleware instead of `handleConnection`:
  //   NestJS's `handleConnection` is async but the Socket.IO server doesn't
  //   block message processing until it resolves — meaning a client can
  //   send `room:join` before `client.data.userId` has been written. The
  //   official Socket.IO pattern for connect-time auth is middleware,
  //   which IS awaited before the 'connection' event fires and before any
  //   message handler runs.
  // ────────────────────────────────────────────────────────────

  afterInit(server: Server): void {
    server.use(async (socket, next) => {
      const hasCookie = Boolean(socket.handshake.headers.cookie);
      const hasBearer = Boolean(
        socket.handshake.auth?.token || socket.handshake.headers.authorization,
      );

      try {
        const session = await auth.api.getSession({
          headers: fromNodeHeaders(socket.handshake.headers),
        });

        if (!session) {
          this.logger.warn(
            `Rejected realtime handshake (no session) — cookie:${hasCookie} bearer:${hasBearer} origin:${socket.handshake.headers.origin ?? '(none)'}`,
          );
          return next(new Error('unauthenticated'));
        }

        const data = socket.data as AuthedSocketData;
        data.userId = session.user.id;
        data.joinedEventIds = new Set<string>();
        this.logger.log(
          `Realtime authed: socket pending, user ${session.user.id}`,
        );
        next();
      } catch (err) {
        this.logger.error(
          `Realtime auth threw — cookie:${hasCookie} bearer:${hasBearer}`,
          err instanceof Error ? err.stack : String(err),
        );
        next(new Error('auth_failed'));
      }
    });
  }

  // ────────────────────────────────────────────────────────────
  // Connect / disconnect — by now middleware has already authed.
  // ────────────────────────────────────────────────────────────

  handleConnection(client: AuthedSocket): void {
    this.logger.log(`Realtime connected: ${client.id} (user ${client.data.userId})`);
  }

  handleDisconnect(client: AuthedSocket): void {
    // Socket.IO leaves rooms automatically on disconnect; nothing extra to do.
    client.data?.joinedEventIds?.clear();
  }

  // ────────────────────────────────────────────────────────────
  // Room join / leave
  // ────────────────────────────────────────────────────────────

  @SubscribeMessage('room:join')
  async onJoinRoom(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() payload: RoomJoinPayload,
  ): Promise<{ ok: boolean; reason?: string }> {
    const userId = client.data?.userId;
    if (!userId) return { ok: false, reason: 'unauthenticated' };
    if (!payload?.eventId) return { ok: false, reason: 'missing_event_id' };

    // Phase 4: any planning member can join the room. Direct DB lookup
    // rather than injecting MembersService to avoid a module dependency
    // cycle (RealtimeModule is @Global; MembersService injects RealtimeGateway).
    const membership = await this.prisma.planningMember.findUnique({
      where: { eventId_userId: { eventId: payload.eventId, userId } },
      select: { role: true },
    });
    if (!membership) {
      return { ok: false, reason: 'not_authorized' };
    }

    const room = this.roomFor(payload.eventId);
    await client.join(room);
    client.data.joinedEventIds.add(payload.eventId);
    this.logger.log(
      `Socket ${client.id} (user ${userId}, role ${membership.role}) joined ${room} (local size: ${this.localRoomSize(room)})`,
    );
    return { ok: true };
  }

  @SubscribeMessage('room:leave')
  async onLeaveRoom(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() payload: RoomJoinPayload,
  ): Promise<{ ok: boolean }> {
    if (!payload?.eventId) return { ok: false };
    await client.leave(this.roomFor(payload.eventId));
    client.data?.joinedEventIds?.delete(payload.eventId);
    return { ok: true };
  }

  // ────────────────────────────────────────────────────────────
  // Broadcast — called by services after DB commit
  // ────────────────────────────────────────────────────────────

  /**
   * Notify every client in this event's room that a segment changed.
   * Clients refetch the segment (and the room overview if they're on it).
   *
   * Coarse-grained on purpose: server is the source of truth, clients
   * always refetch — no incremental state-sync bugs.
   */
  broadcastSegmentChanged(eventId: string, segmentId: string): void {
    const room = this.roomFor(eventId);
    if (!this.server) {
      this.logger.warn(
        `broadcastSegmentChanged called before server was ready (event ${eventId})`,
      );
      return;
    }
    const localSize = this.localRoomSize(room);
    this.logger.log(
      `→ segment.changed to ${room} (local size: ${localSize}, segment: ${segmentId})`,
    );
    this.server.to(room).emit('segment.changed', {
      eventId,
      segmentId,
      _id: randomUUID(),
      ts: Date.now(),
    });
  }

  /**
   * Event-level change (segment list shape changed — Phase 4 add/remove).
   * Currently unused by Phase 3d but reserved.
   */
  broadcastEventChanged(eventId: string): void {
    this.server
      ?.to(this.roomFor(eventId))
      .emit('event.changed', { eventId, _id: randomUUID(), ts: Date.now() });
  }

  /**
   * Number of sockets in the room as seen by THIS API instance. With the
   * Redis adapter this excludes remote-instance sockets — fine for dev
   * diagnostics; multi-instance counts need `fetchSockets()`.
   */
  private localRoomSize(room: string): number {
    return this.server?.sockets?.adapter?.rooms?.get(room)?.size ?? 0;
  }

  private roomFor(eventId: string): string {
    return `room:${eventId}`;
  }
}
