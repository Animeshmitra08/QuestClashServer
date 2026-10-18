import type { LevelDefinition, SpawnPointDefinition } from "@/types/game";
import type { DoorState, MatchPlayer, MatchState, PlayerId } from "@/types/state";

import { INITIAL_PUZZLE_STATE } from "./PuzzleSystem";

/** A fresh match with no players yet: every puzzle unsolved, every door locked, nothing collected. */
export function createInitialMatchState(level: LevelDefinition): MatchState {
  const doors: Record<string, DoorState> = {};
  for (const item of level.interactables) {
    if (item.kind === "door") doors[item.id] = { status: "locked", openedBy: null };
  }

  return {
    status: "playing",
    failReason: null,
    elapsedSeconds: 0,
    world: {
      collectedPickups: {},
      puzzles: Object.fromEntries(level.puzzles.map((p) => [p.id, INITIAL_PUZZLE_STATE])),
      doors,
      completedObjectives: {},
    },
    players: {},
    playerOrder: [],
  };
}

/** Look up a spawn point. Throws for an unknown id, since validateLevel rules that out. */
export function getSpawnPoint(level: LevelDefinition, id: string): SpawnPointDefinition {
  const spawn = level.spawnPoints.find((point) => point.id === id);
  if (!spawn) throw new Error(`Unknown spawn point "${id}"`);
  return spawn;
}

/** A copy of `state` with one player's personal state changed. */
export function withPlayer(state: MatchState, playerId: PlayerId, changes: Partial<MatchPlayer>): MatchState {
  return { ...state, players: { ...state.players, [playerId]: { ...state.players[playerId], ...changes } } };
}

// --- Selectors: read MatchState without depending on its exact shape --------------

export const getPlayer = (state: MatchState, playerId: PlayerId): MatchPlayer | undefined => state.players[playerId];

export const listPlayers = (state: MatchState): MatchPlayer[] => state.playerOrder.map((id) => state.players[id]);

/** Shared: the pickup is gone from the world (someone took it). */
export const isPickupCollected = (state: MatchState, pickupId: string) =>
  state.world.collectedPickups[pickupId] !== undefined;

/** Shared: any player has read this clue. */
export const isInspected = (state: MatchState, interactableId: string) =>
  listPlayers(state).some((player) => player.inspectedIds.includes(interactableId));

/** Personal: this player has read this clue. */
export const hasRead = (state: MatchState, playerId: PlayerId, interactableId: string) =>
  state.players[playerId]?.inspectedIds.includes(interactableId) ?? false;

export const isPuzzleSolved = (state: MatchState, puzzleId: string) =>
  state.world.puzzles[puzzleId]?.status === "solved";

export const isDoorOpen = (state: MatchState, doorId: string) => state.world.doors[doorId]?.status === "open";

/** Clues read by at least one player (each counted once). */
export const distinctCluesRead = (state: MatchState) =>
  new Set(listPlayers(state).flatMap((player) => player.inspectedIds)).size;

export const countSolvedPuzzles = (state: MatchState) =>
  Object.values(state.world.puzzles).filter((p) => p.status === "solved").length;

export const countOpenDoors = (state: MatchState) =>
  Object.values(state.world.doors).filter((door) => door.status === "open").length;

export const countWrongAnswers = (state: MatchState) =>
  listPlayers(state).reduce((total, player) => total + player.wrongAnswers, 0);

export const countTrapHits = (state: MatchState) =>
  listPlayers(state).reduce((total, player) => total + player.trapHits, 0);
