import type { LevelDefinition } from "@/types/game";
import type { MatchState } from "@/types/state";

import type { CollisionSystem } from "./CollisionSystem";
import { isDoorOpen, isPickupCollected } from "./gameState";
import type { InteractionSystem } from "./InteractionSystem";

/**
 * Make a client's local collision and interaction match the shared world:
 * collected pickups can no longer be used (they reappear if returned), and opened
 * doors stop blocking the way, for every player.
 *
 * It recomputes everything from the state instead of reacting to individual
 * events, so it is safe to call any number of times.
 */
export function syncWorldWithState(
  level: LevelDefinition,
  state: MatchState,
  collision: CollisionSystem,
  interaction: InteractionSystem,
) {
  for (const item of level.interactables) {
    switch (item.kind) {
      case "pickup":
        interaction.setEnabled(item.id, !isPickupCollected(state, item.id));
        break;
      case "door": {
        const open = isDoorOpen(state, item.id);
        collision.setEnabled(item.id, !open);
        interaction.setEnabled(item.id, !open);
        break;
      }
    }
  }
}
