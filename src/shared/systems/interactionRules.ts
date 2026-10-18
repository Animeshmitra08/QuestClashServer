import type { Interactable, InteractableKind, LevelDefinition } from "@/types/game";
import type { RejectReason } from "@/types/commands";
import type { GameEvent, InteractionResult, MatchState, Notice, PlayerId } from "@/types/state";

import { blockReason, checkDoor, consumedItemIds, DOOR_TRANSITIONS } from "./DoorSystem";
import { hasRead, isPickupCollected, isPuzzleSolved, withPlayer } from "./gameState";
import { addItem, removeItem } from "./InventorySystem";
import { getPuzzle } from "./PuzzleSystem";
import { nextState } from "./stateMachine";

/** A pop-up for one player, or for every player in the match. */
export interface NoticeRequest {
  to: PlayerId | "everyone";
  text: string;
  tone: Notice["tone"];
}

/** Everything that follows from one player using one object. Handlers are pure. */
export type InteractionOutcome =
  | {
      accepted: true;
      state: MatchState;
      /** What the acting player's screen should show. */
      result: InteractionResult;
      events: GameEvent[];
      notices: NoticeRequest[];
    }
  | { accepted: false; reason: RejectReason; notices: NoticeRequest[] };

export interface InteractionContext {
  state: MatchState;
  level: LevelDefinition;
  /** The player responsible for the action. Already checked to be active. */
  actor: PlayerId;
}

type Handler<K extends InteractableKind> = (
  target: Extract<Interactable, { kind: K }>,
  context: InteractionContext,
) => InteractionOutcome;

const reject = (reason: RejectReason, notices: NoticeRequest[] = []): InteractionOutcome => ({
  accepted: false,
  reason,
  notices,
});

/** "You opened…" for the actor, "Ana opened…" for everyone else. */
function announce(
  context: InteractionContext,
  toActor: string,
  toOthers: (name: string) => string,
  tone: Notice["tone"],
): NoticeRequest[] {
  const name = context.state.players[context.actor].name;
  const others = context.state.playerOrder.filter((id) => id !== context.actor);
  return [
    { to: context.actor, text: toActor, tone },
    ...others.map((id): NoticeRequest => ({ to: id, text: toOthers(name), tone: "info" })),
  ];
}

/**
 * What using each kind of object does, and for whom. The mapped type makes
 * TypeScript reject this object until every Interactable kind has a handler.
 *
 * Ownership (see docs/MULTIPLAYER.md):
 *  - inspect: personal. Each player reads clues for themselves; nothing is used up.
 *  - pickup:  the world object is shared (the first collector takes it; it vanishes
 *             for everyone), the item is personal (only the holder can use it).
 *  - puzzle:  shared. Opening it is personal (a panel on one screen), solving it
 *             counts for the whole team.
 *  - door:    shared. Opened with the actor's own items; once open, open for all.
 */
export const interactionRules: { [K in InteractableKind]: Handler<K> } = {
  inspect(target, context) {
    const { state, actor } = context;
    const firstTime = !hasRead(state, actor, target.id);
    const player = state.players[actor];
    return {
      accepted: true,
      state: firstTime ? withPlayer(state, actor, { inspectedIds: [...player.inspectedIds, target.id] }) : state,
      result: { type: "message", title: target.title, message: target.message },
      events: [{ type: "inspected", playerId: actor, interactableId: target.id, firstTime }],
      notices: [],
    };
  },

  pickup(target, context) {
    const { state, actor } = context;
    if (isPickupCollected(state, target.id)) {
      const takerId = state.world.collectedPickups[target.id];
      const taker = takerId === actor ? "You" : (state.players[takerId]?.name ?? "Someone");
      return reject("alreadyCollected", [{ to: actor, text: `${taker} already took the ${target.item.name}.`, tone: "info" }]);
    }

    const player = state.players[actor];
    const inventory = addItem(player.inventory, target.item);
    if (inventory === player.inventory) {
      return reject("inventoryFull", [{ to: actor, text: "You can't carry any more.", tone: "info" }]);
    }

    const collected = withPlayer(state, actor, { inventory });
    return {
      accepted: true,
      state: { ...collected, world: { ...collected.world, collectedPickups: { ...collected.world.collectedPickups, [target.id]: actor } } },
      result: { type: "none" },
      events: [{ type: "itemCollected", playerId: actor, item: target.item, pickupId: target.id }],
      notices: announce(context, `You found the ${target.item.name}!`, (name) => `${name} found the ${target.item.name}.`, "success"),
    };
  },

  puzzle(target, context) {
    const { state, level, actor } = context;
    if (isPuzzleSolved(state, target.puzzleId)) {
      return { accepted: true, state, result: { type: "message", ...target.solvedMessage }, events: [], notices: [] };
    }
    return {
      accepted: true,
      state,
      result: { type: "puzzle", puzzle: getPuzzle(level.puzzles, target.puzzleId) },
      events: [{ type: "puzzleOpened", playerId: actor, puzzleId: target.puzzleId }],
      notices: [],
    };
  },

  door(target, context) {
    const { state, actor } = context;
    const check = checkDoor(target, state, actor);
    if (!check.canOpen) {
      // Two players opening at once: the second finds it already open. Nothing is spent.
      if (check.reason === "alreadyOpen") return reject("alreadyOpen");
      return {
        accepted: true,
        state,
        result: { type: "message", ...check.requirement.blockedMessage },
        events: [{ type: "doorBlocked", playerId: actor, doorId: target.id, reason: blockReason(check.requirement) }],
        notices: [],
      };
    }

    // checkDoor confirmed that "unlock" is valid and the actor holds every required item.
    const status = nextState(DOOR_TRANSITIONS, state.world.doors[target.id]?.status ?? "locked", "unlock") ?? "open";
    const player = state.players[actor];
    const usedUp = player.inventory.filter((held) => consumedItemIds(target).includes(held.id));
    const afterItems = withPlayer(state, actor, {
      inventory: usedUp.reduce((inventory, item) => removeItem(inventory, item.id), player.inventory),
    });
    return {
      accepted: true,
      state: {
        ...afterItems,
        world: { ...afterItems.world, doors: { ...afterItems.world.doors, [target.id]: { status, openedBy: actor } } },
      },
      result: { type: "none" },
      events: [
        ...usedUp.map((item): GameEvent => ({ type: "itemUsed", playerId: actor, item })),
        { type: "doorOpened", playerId: actor, doorId: target.id },
      ],
      notices: announce(context, "The door grinds open…", (name) => `${name} opened the door.`, "success"),
    };
  },
};

/** Run the handler for `target`'s kind. */
export function runInteraction(target: Interactable, context: InteractionContext): InteractionOutcome {
  // TypeScript can't connect `target.kind` to the matching handler's parameter type
  // on its own; the mapped type above guarantees they match.
  const handler = interactionRules[target.kind] as Handler<InteractableKind>;
  return handler(target as never, context);
}
