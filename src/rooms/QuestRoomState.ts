import { schema, type SchemaType, t } from "@colyseus/schema";

import type { SyncedPlayer, SyncedRoomState } from "@/net/protocol";

/**
 * State Colyseus keeps in sync on every client, sent as small binary patches.
 * It holds what changes often (player bodies) and the lobby. The match rules'
 * state (MatchState) is sent separately as a `match` message, because it changes
 * rarely and is shared with the app as a plain TypeScript type.
 */
export const PlayerInfo = schema(
  {
    name: t.string().default(""),
    slot: t.number().default(0),
    ready: t.boolean().default(false),
    connected: t.boolean().default(true),
    // Body, as last accepted by the server.
    x: t.number().default(0),
    z: t.number().default(0),
    facing: t.number().default(0),
    moveAmount: t.number().default(0),
  },
  "PlayerInfo",
);
export type PlayerInfo = SchemaType<typeof PlayerInfo>;

export const QuestRoomState = schema(
  {
    code: t.string().default(""),
    /** RoomPhase: "lobby" | "playing" | "finished". */
    phase: t.string().default("lobby"),
    levelId: t.string().default(""),
    hostId: t.string().default(""),
    /** Exact match time in seconds, so clients can keep traps in step. */
    matchTime: t.number().default(0),
    players: t.map(PlayerInfo),
  },
  "QuestRoomState",
);
export type QuestRoomState = SchemaType<typeof QuestRoomState>;

// Compile-time check that this schema matches what the app expects (src/net/protocol.ts).
type Matches<A, B extends A> = B;
export type SchemaMatchesProtocol = [Matches<SyncedPlayer, PlayerInfo>, Matches<SyncedRoomState, QuestRoomState>];
