import type { LevelDefinition, ObjectiveCondition, ObjectiveDefinition } from "@/types/game";
import type { MatchState, PlayerId } from "@/types/state";

import { isDoorOpen, isInspected, isPickupCollected, isPuzzleSolved } from "./gameState";

/**
 * Objectives are shared team goals, evaluated on shared state. A clue condition
 * is met once any player has read it.
 */
export function isConditionMet(condition: ObjectiveCondition, state: MatchState): boolean {
  switch (condition.kind) {
    case "pickupCollected":
      return isPickupCollected(state, condition.pickupId);
    case "inspected":
      return isInspected(state, condition.interactableId);
    case "puzzleSolved":
      return isPuzzleSolved(state, condition.puzzleId);
    case "doorOpened":
      return isDoorOpen(state, condition.doorId);
    case "levelCompleted":
      return state.status === "completed";
    case "any":
      return condition.of.some((inner) => isConditionMet(inner, state));
  }
}

export interface ObjectiveProgress {
  /** The first objective not yet done, or null once all are done. */
  current: ObjectiveDefinition | null;
  completed: number;
  total: number;
}

/**
 * The objective to show is the first one, in level order, whose condition isn't
 * true right now. This is live: if a key returns to the world (its holder was
 * eliminated), "find the key" comes back. Objectives are data in the level, so a
 * new level brings its own list without any change here or in the HUD.
 */
export function getObjectiveProgress(level: LevelDefinition, state: MatchState): ObjectiveProgress {
  const done = level.objectives.map((objective) => isConditionMet(objective.completeWhen, state));
  const currentIndex = done.indexOf(false);
  return {
    current: currentIndex === -1 ? null : level.objectives[currentIndex],
    completed: done.filter(Boolean).length,
    total: level.objectives.length,
  };
}

/**
 * Objectives met in `state` that haven't been credited to anyone yet. The match
 * credits them to the player whose action caused the change; credit is permanent,
 * even if the condition later stops being true.
 */
export function newlyCompletedObjectives(level: LevelDefinition, state: MatchState): ObjectiveDefinition[] {
  return level.objectives.filter(
    (objective) => !(objective.id in state.world.completedObjectives) && isConditionMet(objective.completeWhen, state),
  );
}

/** Record credit for objectives. Pure. */
export function creditObjectives(
  state: MatchState,
  objectiveIds: readonly string[],
  playerId: PlayerId | null,
): MatchState {
  if (objectiveIds.length === 0) return state;
  const credited = { ...state.world.completedObjectives };
  for (const id of objectiveIds) credited[id] = playerId;
  return { ...state, world: { ...state.world, completedObjectives: credited } };
}
