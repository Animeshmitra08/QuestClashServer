/**
 * A minimal protocol client for tests and scripts, built on the Colyseus SDK.
 * It speaks the same messages as the app (src/shared/net/protocol.ts) but has no
 * UI, no smoothing and no React: just enough to act as a separate player.
 */
import { Client, type Room } from "@colyseus/sdk";

import {
  type ClientCommand,
  type ClientMessages,
  normalizeRoomCode,
  PROTOCOL_VERSION,
  ROOM_NAME,
  type ServerMessages,
  type SyncedRoomState,
} from "@/net/protocol";
import type { CommandResult } from "@/types/commands";
import type { MatchState } from "@/types/state";

export interface JoinFailure {
  code: number | undefined;
  message: string;
}

const COMMAND_TIMEOUT_MS = 5000;

export class TestClient {
  match: MatchState | null = null;
  matchNumber = 0;
  matchLevelId: string | null = null;
  /** Last `error` message from the server. */
  lastError: ServerMessages["error"] | null = null;
  connected = true;
  respawnSeq = 0;
  lastRespawn: ServerMessages["respawn"] | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<number, (result: CommandResult) => void>();

  private constructor(readonly room: Room<unknown, SyncedRoomState>) {
    room.onMessage("match", (message: ServerMessages["match"]) => {
      this.match = message.state;
      this.matchNumber = message.matchNumber;
      this.matchLevelId = message.levelId;
    });
    room.onMessage("commandResult", (message: ServerMessages["commandResult"]) => {
      this.pending.get(message.requestId)?.(message.result);
      this.pending.delete(message.requestId);
    });
    room.onMessage("respawn", (message: ServerMessages["respawn"]) => {
      this.respawnSeq = Math.max(this.respawnSeq, message.seq);
      this.lastRespawn = message;
    });
    room.onMessage("events", () => {});
    room.onMessage("error", (message: ServerMessages["error"]) => (this.lastError = message));
    room.onDrop(() => (this.connected = false));
    room.onReconnect(() => (this.connected = true));
    room.onLeave(() => (this.connected = false));
  }

  /** Create a room. Throws a JoinFailure on refusal. */
  static async create(url: string, name: string, extra: { levelId?: string; protocolVersion?: number } = {}) {
    return TestClient.open(() =>
      new Client(url).create<SyncedRoomState>(ROOM_NAME, { name, protocolVersion: PROTOCOL_VERSION, ...extra }),
    );
  }

  /** Join a room by code. Throws a JoinFailure on refusal. */
  static async join(url: string, code: string, name: string, extra: { protocolVersion?: number } = {}) {
    return TestClient.open(() =>
      new Client(url).joinById<SyncedRoomState>(normalizeRoomCode(code), { name, protocolVersion: PROTOCOL_VERSION, ...extra }),
    );
  }

  private static async open(open: () => Promise<Room<unknown, SyncedRoomState>>) {
    try {
      const client = new TestClient(await open());
      await waitFor("first state sync", () => client.room.state?.players?.size > 0);
      return client;
    } catch (error) {
      const failure: JoinFailure = {
        code: (error as { code?: number }).code,
        message: String((error as { message?: string }).message ?? error),
      };
      throw failure;
    }
  }

  get id() {
    return this.room.sessionId;
  }

  get code() {
    return this.room.roomId;
  }

  get state(): SyncedRoomState {
    return this.room.state;
  }

  /** Server-accepted position of any player, from the synced state. */
  positionOf(playerId: string) {
    const player = this.state.players.get(playerId);
    return player ? { x: player.x, z: player.z } : null;
  }

  send<K extends keyof ClientMessages>(type: K, message: ClientMessages[K]) {
    this.room.send(type, message);
  }

  setReady(ready = true) {
    this.send("ready", { ready });
  }

  move(x: number, z: number, facing = Math.PI) {
    this.send("move", { x, z, facing, moveAmount: 1, respawnSeq: this.respawnSeq });
  }

  command(command: ClientCommand): Promise<CommandResult> {
    const requestId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no answer to ${command.type}`)), COMMAND_TIMEOUT_MS);
      this.pending.set(requestId, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
      this.send("command", { requestId, command });
    });
  }

  /** Walk from the server's current position to each point at ~walking speed, reporting like the app does. */
  async walk(path: { x: number; z: number }[], speed = 4, stepSeconds = 0.05) {
    const position = { ...(this.positionOf(this.id) ?? { x: 0, z: 0 }) };
    for (const target of path) {
      for (;;) {
        const dx = target.x - position.x;
        const dz = target.z - position.z;
        const distance = Math.hypot(dx, dz);
        if (distance < 0.05) break;
        const step = Math.min(distance, speed * stepSeconds);
        position.x += (dx / distance) * step;
        position.z += (dz / distance) * step;
        this.move(position.x, position.z);
        await sleep(stepSeconds * 1000);
      }
    }
    // Let the last report land.
    for (let i = 0; i < 4; i++) {
      this.move(position.x, position.z);
      await sleep(stepSeconds * 1000);
    }
    return position;
  }

  /** Simulate the network dropping (not a deliberate leave). */
  dropConnection() {
    const room = this.room as unknown as {
      reconnection: { minUptime: number };
      connection: { transport: { ws: WebSocket } };
    };
    room.reconnection.minUptime = 0; // let the SDK retry immediately
    room.connection.transport.ws.close();
  }

  async leave() {
    if (this.room.connection.isOpen) await this.room.leave(true).catch(() => {});
    this.connected = false;
  }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitFor(what: string, predicate: () => boolean, timeoutMs = 5000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for: ${what}`);
    await sleep(20);
  }
}
