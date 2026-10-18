import type { LevelDefinition, SpawnPoint } from "@/types/game";
import type { MatchPlayer, MatchState, PlayerEvent, PlayerId, PlayerStatus } from "@/types/state";

import { getSpawnPoint } from "./gameState";
import { nextState, type TransitionTable } from "./stateMachine";

export const MAX_PLAYERS = 5;

/**
 * active --eliminate--> eliminated   (ran out of lives)
 * active --escape--> escaped         (reached an open exit)
 * any but left --leave--> left       (quit or disconnected)
 */
export const PLAYER_TRANSITIONS: TransitionTable<PlayerStatus, PlayerEvent> = {
  active: { eliminate: "eliminated", escape: "escaped", leave: "left" },
  eliminated: { leave: "left" },
  escaped: { leave: "left" },
  left: {},
};

export interface PlayerProfile {
  id: PlayerId;
  name: string;
}

export type JoinRejectReason = "invalidId" | "duplicateId" | "matchFull" | "matchFinished";

export type JoinResult =
  | { ok: true; state: MatchState; player: MatchPlayer }
  | { ok: false; reason: JoinRejectReason };

/**
 * Sideways offsets from a spawn point, one per slot, so up to five players stand
 * in a row instead of inside each other. A single row (no second line in front or
 * behind) keeps everyone off nearby doors and traps at checkpoints. 1 unit apart
 * is wider than a player. Slot 0 stands exactly on the spawn point, which keeps
 * single player identical to before.
 */
const ROW_OFFSETS: readonly number[] = [0, -1, 1, -2, 2];

/** Where the player in `slot` appears for spawn point `spawnId` (the row is turned to face the same way). */
export function spawnFor(level: LevelDefinition, spawnId: string, slot: number): SpawnPoint {
  const spawn = getSpawnPoint(level, spawnId);
  const sideways = ROW_OFFSETS[slot % ROW_OFFSETS.length];
  return {
    position: {
      x: spawn.position.x + sideways * Math.cos(spawn.facing),
      z: spawn.position.z - sideways * Math.sin(spawn.facing),
    },
    facing: spawn.facing,
  };
}

/** The lowest slot no current player holds, or null if the match is full. */
export function freeSlot(state: MatchState): number | null {
  const taken = new Set(state.playerOrder.filter((id) => state.players[id].status !== "left").map((id) => state.players[id].slot));
  for (let slot = 0; slot < MAX_PLAYERS; slot++) if (!taken.has(slot)) return slot;
  return null;
}

/**
 * Register a player. Ids must be unique for the whole match, including players
 * who have left, so a returning player can't take over someone else's record.
 */
export function addPlayer(state: MatchState, profile: PlayerProfile, livesPerPlayer: number | null): JoinResult {
  if (!profile.id || typeof profile.id !== "string") return { ok: false, reason: "invalidId" };
  if (state.players[profile.id]) return { ok: false, reason: "duplicateId" };
  if (state.status === "completed" || state.status === "failed") return { ok: false, reason: "matchFinished" };
  const slot = freeSlot(state);
  if (slot === null) return { ok: false, reason: "matchFull" };

  const player: MatchPlayer = {
    id: profile.id,
    name: profile.name,
    slot,
    status: "active",
    inventory: [],
    inspectedIds: [],
    livesRemaining: livesPerPlayer,
    trapHits: 0,
    wrongAnswers: 0,
    notice: null,
  };
  return {
    ok: true,
    player,
    state: {
      ...state,
      players: { ...state.players, [player.id]: player },
      playerOrder: [...state.playerOrder, player.id],
    },
  };
}

/** Move a player through their status machine; null if the move isn't allowed. */
export function playerTransition(player: MatchPlayer, event: PlayerEvent): PlayerStatus | null {
  return nextState(PLAYER_TRANSITIONS, player.status, event);
}

export function activePlayers(state: MatchState): MatchPlayer[] {
  return state.playerOrder.map((id) => state.players[id]).filter((player) => player.status === "active");
}
