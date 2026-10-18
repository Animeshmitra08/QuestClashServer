import type { DoorInteractable, DoorRequirement } from "@/types/game";
import type { DoorBlockReason, DoorEvent, DoorStatus, MatchState, PlayerId } from "@/types/state";

import { hasItem } from "./InventorySystem";
import { nextState, type TransitionTable } from "./stateMachine";

/** locked --unlock--> open. An open door stays open, for everyone. */
export const DOOR_TRANSITIONS: TransitionTable<DoorStatus, DoorEvent> = {
  locked: { unlock: "open" },
  open: {},
};

export type DoorCheck =
  | { canOpen: true }
  | { canOpen: false; reason: "alreadyOpen" }
  | { canOpen: false; reason: "requirement"; requirement: DoorRequirement };

/**
 * Is `requirement` met for `playerId`? Item requirements need the item in *that
 * player's* inventory (keys are personal); puzzle requirements are shared.
 */
export function isRequirementMet(requirement: DoorRequirement, state: MatchState, playerId: PlayerId): boolean {
  switch (requirement.kind) {
    case "item":
      return hasItem(state.players[playerId]?.inventory ?? [], requirement.itemId);
    case "puzzle":
      return state.world.puzzles[requirement.puzzleId]?.status === "solved";
  }
}

/** The event-friendly name for why a requirement blocked a door. */
export function blockReason(requirement: DoorRequirement): DoorBlockReason {
  return requirement.kind === "item" ? "missingItem" : "puzzleUnsolved";
}

/** Can `playerId` open this door right now? Requirements are checked in the order the level lists them. */
export function checkDoor(door: DoorInteractable, state: MatchState, playerId: PlayerId): DoorCheck {
  const status = state.world.doors[door.id]?.status ?? "locked";
  if (nextState(DOOR_TRANSITIONS, status, "unlock") === null) {
    return { canOpen: false, reason: "alreadyOpen" };
  }
  const unmet = door.requirements.find((requirement) => !isRequirementMet(requirement, state, playerId));
  return unmet ? { canOpen: false, reason: "requirement", requirement: unmet } : { canOpen: true };
}

/** Ids of the items opening this door uses up. */
export function consumedItemIds(door: DoorInteractable): string[] {
  return door.requirements.flatMap((r) => (r.kind === "item" && r.consume ? [r.itemId] : []));
}
