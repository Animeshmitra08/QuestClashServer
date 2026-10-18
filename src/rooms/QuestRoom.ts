import { type Client, Room, ServerError } from "@colyseus/core";

import { FIRST_LEVEL_ID, LEVEL_CATALOG } from "@/levels/catalog";
import {
  APP_ERROR_CODES,
  cleanPlayerName,
  type ClientMessages,
  type CreateRoomOptions,
  type JoinRoomOptions,
  MAX_ROOM_PLAYERS,
  NET_ERRORS,
  type NetErrorCode,
  PROTOCOL_VERSION,
  RECONNECT_GRACE_SECONDS,
  type RoomPhase,
  SERVER_TICK_HZ,
  type ServerMessages,
} from "@/net/protocol";
import { createLevelCollision, type CollisionSystem } from "@/systems/CollisionSystem";
import { InteractionSystem } from "@/systems/InteractionSystem";
import { validateLevel } from "@/systems/levelValidation";
import { StageManager } from "@/systems/StageManager";
import { syncWorldWithState } from "@/systems/worldSync";
import type { GameCommand } from "@/types/commands";
import type { LevelDefinition, Vec2 } from "@/types/game";
import type { GameEvent, PlayerId } from "@/types/state";

import { MovementGuard } from "../match/MovementGuard.ts";
import { parseClientCommand, parseMove } from "./messageValidation.ts";
import { claimRoomCode, releaseRoomCode } from "./roomCodes.ts";
import { PlayerInfo, QuestRoomState } from "./QuestRoomState.ts";

function findLevel(levelId: string | undefined): LevelDefinition | null {
  const level = LEVEL_CATALOG.find((candidate) => candidate.id === (levelId ?? FIRST_LEVEL_ID));
  return level && validateLevel(level).length === 0 ? level : null;
}

/** Everything that exists only while a match is being played. */
interface ActiveMatch {
  level: LevelDefinition;
  stage: StageManager;
  collision: CollisionSystem;
  guards: Map<PlayerId, MovementGuard>;
  respawnSeq: Map<PlayerId, number>;
  pendingEvents: GameEvent[];
  stateDirty: boolean;
  unsubscribe: () => void;
}

/**
 * One multiplayer room: a lobby with a shareable code, then matches.
 *
 * Authoritative: the match rules run here, in the same StageManager the app uses
 * for single player. Clients send commands and their player's position; this
 * room validates both, applies the rules, and sends the results back.
 * Player ids are Colyseus session ids, which survive reconnection.
 */
export class QuestRoom extends Room<{ state: QuestRoomState }> {
  /**
   * Not MAX_ROOM_PLAYERS: Colyseus locks a room automatically at maxClients, and a
   * locked room gives the same error as a match in progress. The five-player limit
   * is enforced in onJoin instead, with its own "room full" error.
   */
  maxClients = Infinity;
  state = new QuestRoomState();

  private level!: LevelDefinition;
  private match: ActiveMatch | null = null;
  /** Join order, so slots and the host follow who arrived first. */
  private order: PlayerId[] = [];
  /** Goes up with every match started in this room, so clients can tell matches apart. */
  private matchNumber = 0;

  messages = {
    ready: (client: Client, message: ClientMessages["ready"]) => {
      if (this.phase !== "lobby") return this.refuse(client, "wrongPhase");
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      player.ready = message?.ready === true;
      this.startIfEveryoneReady();
    },

    selectLevel: (client: Client, message: ClientMessages["selectLevel"]) => {
      if (client.sessionId !== this.state.hostId) return this.refuse(client, "notHost");
      if (this.phase !== "lobby") return this.refuse(client, "wrongPhase");
      const level = findLevel(message?.levelId);
      if (!level) return this.refuse(client, "invalidLevel");
      this.level = level;
      this.state.levelId = level.id;
    },

    move: (client: Client, message: ClientMessages["move"]) => {
      const match = this.match;
      const report = parseMove(message);
      const player = this.state.players.get(client.sessionId);
      const guard = match?.guards.get(client.sessionId);
      if (!match || !report || !player || !guard || this.phase !== "playing") return;
      // Ignore reports sent before the client applied our latest respawn.
      if (report.respawnSeq < (match.respawnSeq.get(client.sessionId) ?? 0)) return;

      const { position } = guard.accept({ x: report.x, z: report.z }, Date.now());
      player.x = position.x;
      player.z = position.z;
      player.facing = report.facing;
      player.moveAmount = Math.min(Math.max(report.moveAmount, 0), 1);
    },

    command: (client: Client, message: ClientMessages["command"]) => {
      const requestId = typeof message?.requestId === "number" ? message.requestId : -1;
      const command = parseClientCommand(message?.command);
      const reply = (result: ServerMessages["commandResult"]["result"]) =>
        this.sendTo(client, "commandResult", { requestId, result });

      if (!command) return this.refuse(client, "wrongPhase");
      const full = { ...command, playerId: client.sessionId } as GameCommand;
      if (!this.match || this.phase !== "playing") {
        return reply({ accepted: false, command: full, reason: "matchNotRunning" });
      }
      reply(this.match.stage.dispatch(full));
      this.flush();
    },

    restart: (client: Client) => {
      if (client.sessionId !== this.state.hostId) return this.refuse(client, "notHost");
      if (this.phase !== "finished") return this.refuse(client, "wrongPhase");
      this.startMatch(this.level);
    },

    nextLevel: (client: Client) => {
      if (client.sessionId !== this.state.hostId) return this.refuse(client, "notHost");
      if (this.phase !== "finished") return this.refuse(client, "wrongPhase");
      const next = this.level.nextLevelId ? findLevel(this.level.nextLevelId) : null;
      if (!next) return this.refuse(client, "invalidLevel");
      this.startMatch(next);
    },
  };

  // --- Lifecycle -------------------------------------------------------------

  async onCreate(options: CreateRoomOptions) {
    const level = findLevel(options?.levelId);
    if (!level) throw new ServerError(APP_ERROR_CODES.invalidLevel, NET_ERRORS.invalidLevel);
    this.level = level;
    this.roomId = await claimRoomCode(this.presence);
    this.state.code = this.roomId;
    this.state.levelId = level.id;
    this.setTimestep((deltaMs) => this.tick(deltaMs / 1000), 1000 / SERVER_TICK_HZ);
  }

  /** Decide whether a client may join, before a seat is set up for them. Throwing refuses the join. */
  onAuth(_client: Client, options: JoinRoomOptions) {
    // The app and server are built and deployed separately: refuse a client built for different rules.
    if (options?.protocolVersion !== PROTOCOL_VERSION) {
      throw new ServerError(APP_ERROR_CODES.versionMismatch, NET_ERRORS.versionMismatch);
    }
    if (!cleanPlayerName(options?.name)) throw new ServerError(APP_ERROR_CODES.invalidName, NET_ERRORS.invalidName);
    if (this.phase !== "lobby") throw new ServerError(APP_ERROR_CODES.matchInProgress, NET_ERRORS.matchInProgress);
    // Counts players waiting to reconnect too: their seat is still theirs.
    if (this.state.players.size >= MAX_ROOM_PLAYERS) throw new ServerError(APP_ERROR_CODES.roomFull, NET_ERRORS.roomFull);
    return true;
  }

  onJoin(client: Client, options: JoinRoomOptions) {
    const player = new PlayerInfo();
    player.name = cleanPlayerName(options?.name)!; // checked in onAuth
    player.slot = this.freeSlot();
    this.state.players.set(client.sessionId, player);
    this.order.push(client.sessionId);
    if (!this.state.hostId) this.state.hostId = client.sessionId;
  }

  /** The connection dropped without the player choosing to leave: keep their seat for a while. */
  async onDrop(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.connected = false;
      player.ready = false;
    }
    this.allowReconnection(client, RECONNECT_GRACE_SECONDS);
  }

  onReconnect(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = true;
    // Bring the returning client up to date, including where the server has them.
    if (this.match) {
      this.sendTo(client, "match", { state: this.match.stage.getState(), levelId: this.match.level.id, matchNumber: this.matchNumber });
      const guard = this.match.guards.get(client.sessionId);
      if (guard && player) {
        const seq = (this.match.respawnSeq.get(client.sessionId) ?? 0) + 1;
        this.match.respawnSeq.set(client.sessionId, seq);
        this.sendTo(client, "respawn", { x: guard.current.x, z: guard.current.z, facing: player.facing, seq });
      }
    }
  }

  /** Left for good: chose to leave, or didn't come back in time. */
  onLeave(client: Client) {
    const id = client.sessionId;
    this.state.players.delete(id);
    this.order = this.order.filter((other) => other !== id);
    if (this.match) {
      this.match.stage.removePlayer(id);
      this.match.guards.delete(id);
      this.flush();
    }
    if (this.state.hostId === id) this.state.hostId = this.order[0] ?? "";
    if (this.phase === "lobby") this.startIfEveryoneReady();
  }

  async onDispose() {
    this.match?.unsubscribe();
    await releaseRoomCode(this.presence, this.roomId);
  }

  // --- Match -------------------------------------------------------------------

  private get phase(): RoomPhase {
    return this.state.phase as RoomPhase;
  }

  private startIfEveryoneReady() {
    const players = [...this.state.players.values()];
    const connected = players.filter((player) => player.connected);
    if (this.phase === "lobby" && connected.length > 0 && connected.every((player) => player.ready)) {
      this.startMatch(this.level);
    }
  }

  private startMatch(level: LevelDefinition) {
    this.match?.unsubscribe();
    this.level = level;
    this.state.levelId = level.id;

    const stage = new StageManager(level);
    const collision = createLevelCollision(level);
    const interaction = new InteractionSystem(level.interactables); // only needed to reuse worldSync
    const now = Date.now();
    const match: ActiveMatch = {
      level,
      stage,
      collision,
      guards: new Map(),
      respawnSeq: new Map(),
      pendingEvents: [],
      stateDirty: true,
      unsubscribe: () => {},
    };

    for (const id of this.order) {
      const info = this.state.players.get(id);
      if (!info) continue;
      const joined = stage.addPlayer({ id, name: info.name });
      if (joined.ok) info.slot = joined.player.slot; // the match decides spawn position and colour
      const spawn = stage.spawnPointFor(id);
      match.guards.set(id, new MovementGuard(spawn.position, collision, now));
      info.x = spawn.position.x;
      info.z = spawn.position.z;
      info.facing = spawn.facing;
      info.moveAmount = 0;
      info.ready = false;
    }

    const offState = stage.subscribe(() => {
      match.stateDirty = true;
      syncWorldWithState(level, stage.getState(), collision, interaction); // opened doors stop blocking
    });
    const offEvents = stage.onEvent((event) => match.pendingEvents.push(event));
    match.unsubscribe = () => {
      offState();
      offEvents();
    };

    this.match = match;
    this.matchNumber += 1;
    this.state.matchTime = 0;
    this.state.phase = "playing";
    void this.lock(); // nobody new joins mid-match (reconnecting players still can)
    this.flush();
  }

  /** The authoritative tick: time passes, traps fire, exits and respawns are decided here. */
  private tick(dt: number) {
    const match = this.match;
    if (!match || this.phase !== "playing") return;

    const positions: Record<PlayerId, Vec2> = {};
    for (const [id, info] of this.state.players) {
      const guard = match.guards.get(id);
      if (info.connected && guard) positions[id] = guard.current;
    }

    const { respawns } = match.stage.update(dt, positions);
    for (const [id, respawn] of Object.entries(respawns)) {
      const seq = (match.respawnSeq.get(id) ?? 0) + 1;
      match.respawnSeq.set(id, seq);
      match.guards.get(id)?.reset(respawn.position, Date.now());
      const info = this.state.players.get(id);
      if (info) {
        info.x = respawn.position.x;
        info.z = respawn.position.z;
        info.facing = respawn.facing;
      }
      const client = this.clients.find((c) => c.sessionId === id);
      if (client) this.sendTo(client, "respawn", { x: respawn.position.x, z: respawn.position.z, facing: respawn.facing, seq });
    }

    this.state.matchTime += dt;
    const status = match.stage.getState().status;
    if (status === "completed" || status === "failed") this.state.phase = "finished";
    this.flush();
  }

  /** Send match state and events that changed since the last flush. */
  private flush() {
    const match = this.match;
    if (!match) return;
    if (match.stateDirty) {
      match.stateDirty = false;
      this.broadcastTyped("match", { state: match.stage.getState(), levelId: match.level.id, matchNumber: this.matchNumber });
    }
    if (match.pendingEvents.length > 0) {
      const events = match.pendingEvents;
      match.pendingEvents = [];
      this.broadcastTyped("events", { events });
    }
  }

  // --- Helpers -------------------------------------------------------------------

  private freeSlot(): number {
    const taken = new Set([...this.state.players.values()].map((player) => player.slot));
    for (let slot = 0; slot < MAX_ROOM_PLAYERS; slot++) if (!taken.has(slot)) return slot;
    return 0;
  }

  private refuse(client: Client, code: NetErrorCode) {
    this.sendTo(client, "error", { code, message: NET_ERRORS[code] });
  }

  private sendTo<K extends keyof ServerMessages>(client: Client, type: K, message: ServerMessages[K]) {
    client.send(type, message);
  }

  private broadcastTyped<K extends keyof ServerMessages>(type: K, message: ServerMessages[K]) {
    this.broadcast(type, message);
  }
}
