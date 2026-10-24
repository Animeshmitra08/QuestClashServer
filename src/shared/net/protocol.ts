/**
 * The client–server protocol. The Expo app and the Colyseus server (QuestClashServer) each
 * keep an identical copy of this file. Plain types and constants only: no React
 * Native, no Colyseus imports, so it compiles on both sides.
 *
 * Who decides what:
 *  - The server is authoritative for every gameplay rule: item collection, puzzle
 *    answers, doors, traps, objectives, score and stage progression. It runs the
 *    same StageManager as single player.
 *  - Each client moves its own player locally (so controls feel instant) and
 *    reports its position; the server checks every report (speed, walls) before
 *    using it, and corrects the client (respawn) when needed.
 */
import type { CommandResult, GameCommand } from "@/types/commands";
import type { GameEvent, MatchState, PlayerId } from "@/types/state";

/**
 * The app and the server each keep their own copy of this file (and of the game
 * rules), so they can be built and deployed separately. Bump this number whenever
 * messages, rules or levels change in a way the other side must match; a client
 * with a different number is refused with a clear "update" message.
 */
export const PROTOCOL_VERSION = 4;

/** The Colyseus room type name. */
export const ROOM_NAME = "quest";
export const MAX_ROOM_PLAYERS = 5;
/** Room codes: 5 characters from this set (no 0/O or 1/I/L, which are easy to confuse). */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 5;
export const MAX_NAME_LENGTH = 16;

/** How often clients report their position, and the server runs a match tick. */
export const CLIENT_SEND_HZ = 15;
export const SERVER_TICK_HZ = 20;

/** How often each client measures its round trip to the server and reports it. */
export const PING_INTERVAL_MS = 2000;
/** Reported pings are clamped to this (ms), so a bad value can't show nonsense. */
export const MAX_REPORTED_PING_MS = 9999;

/** Seconds the server keeps a dropped player's seat open for them to reconnect. */
export const RECONNECT_GRACE_SECONDS = 30;

/**
 * "lobby": players join and get ready. "playing": a match is running; new joins are
 * refused with "matchInProgress" (only dropped players can reconnect). "finished": the match ended; the room
 * is open again, so players who left can rejoin with the code before the host starts
 * the next match or goes back to the lobby. If the host leaves, the room closes for everyone.
 */
export type RoomPhase = "lobby" | "playing" | "finished";

/** Options a client passes when creating a room. */
export interface CreateRoomOptions {
  name: string;
  protocolVersion: number;
  /** Level to play; defaults to the first level. The host can change it in the lobby. */
  levelId?: string;
}

/** Options a client passes when joining by code. */
export interface JoinRoomOptions {
  name: string;
  protocolVersion: number;
}

/** A command as the client sends it: the server fills in who sent it, so it can't be faked. */
export type ClientCommand = GameCommand extends infer C
  ? C extends GameCommand
    ? Omit<C, "playerId" | "tick" | "sequence">
    : never
  : never;

// --- Client → server -------------------------------------------------------------

export interface ClientMessages {
  /** Lobby: toggle ready. The match starts when every connected player is ready. */
  ready: { ready: boolean };
  /** Lobby, host only. */
  selectLevel: { levelId: string };
  /** Playing: where this player's body is. `respawnSeq` = last respawn applied, so stale reports are ignored. */
  move: { x: number; z: number; facing: number; moveAmount: number; respawnSeq: number };
  /** Playing: a gameplay command. The reply comes back as `commandResult` with the same requestId. */
  command: { requestId: number; command: ClientCommand };
  /** Finished, host only: play the same level again, or go on to the next one. */
  restart: Record<string, never>;
  nextLevel: Record<string, never>;
  /** Finished, host only: end the match and take everyone back to the lobby to get ready again. */
  backToLobby: Record<string, never>;
  /** Any time: this client's latest measured round trip to the server, in ms (shown to everyone). */
  reportPing: { ms: number };
}

// --- Server → client -------------------------------------------------------------

export interface ServerMessages {
  /**
   * The full match state, sent whenever it changes (at human speed, not per frame).
   * `matchNumber` goes up with every new match in the room (restart, next level).
   */
  match: { state: MatchState; levelId: string; matchNumber: number };
  commandResult: { requestId: number; result: CommandResult };
  /** Move your player here (a trap hit). Echo `seq` back in later `move` messages. */
  respawn: { x: number; z: number; facing: number; seq: number };
  /** Gameplay events, for sounds and effects. Each names the player responsible. */
  events: { events: GameEvent[] };
  /** A request was refused. */
  error: { code: NetErrorCode; message: string };
}

/**
 * The state Colyseus keeps in sync on every client (binary patches). The server's
 * schema (src/rooms/QuestRoomState.ts in the server project) must match these shapes; it checks
 * that at compile time.
 */
export interface SyncedPlayer {
  name: string;
  slot: number;
  ready: boolean;
  connected: boolean;
  x: number;
  z: number;
  facing: number;
  moveAmount: number;
  /** Round trip to the server in ms, as last reported by this player; 0 = not measured yet. */
  ping: number;
}

export interface SyncedRoomState {
  code: string;
  phase: string;
  levelId: string;
  hostId: string;
  /** Exact match time in seconds, for keeping traps in step. */
  matchTime: number;
  players: {
    get(id: string): SyncedPlayer | undefined;
    forEach(callback: (player: SyncedPlayer, id: string) => void): void;
    readonly size: number;
  };
}

export type ClientMessageType = keyof ClientMessages;
export type ServerMessageType = keyof ServerMessages;

/**
 * Network errors the app can show. Server-sent ones arrive in `error` messages or
 * as join failures; the client adds the connection ones itself.
 */
export const NET_ERRORS = {
  roomNotFound: "No room with that code. Check the code and try again.",
  roomFull: "That room is full (5 players).",
  matchInProgress: "That match has already started.",
  invalidName: "Enter a name (1–16 characters).",
  invalidLevel: "That level doesn't exist.",
  notHost: "Only the host can do that.",
  wrongPhase: "That isn't possible right now.",
  versionMismatch: "This version of the app doesn't match the game server. Update the app (or the server).",
  serverUnreachable: "Can't reach the game server. Check your connection and the server address.",
  connectionLost: "Connection to the game server was lost.",
  requestTimedOut: "The server didn't answer in time.",
  hostLeft: "The host left, so the room was closed.",
} as const;

export type NetErrorCode = keyof typeof NET_ERRORS;

/** Application close/join error codes in the range Colyseus reserves for apps (4011–4999). */
export const APP_ERROR_CODES: Record<
  "roomFull" | "matchInProgress" | "invalidName" | "invalidLevel" | "versionMismatch" | "hostLeft",
  number
> = {
  roomFull: 4101,
  matchInProgress: 4102,
  invalidName: 4103,
  invalidLevel: 4104,
  versionMismatch: 4105,
  /** Close code sent to everyone when the host leaves and the room shuts down. */
  hostLeft: 4106,
};

/** A display name the server accepts: trimmed, 1–16 characters. */
export function cleanPlayerName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}

/** Room codes are case-insensitive for people; this is the canonical form. */
export function normalizeRoomCode(code: string): string {
  return code.trim().toUpperCase();
}

export type { PlayerId };
