/**
 * Gameplay commands: everything a player can ask the match to do, as plain
 * serializable data. Today the local screen creates them; later the same objects
 * can travel over the network to an authoritative host unchanged.
 *
 * Every command names the player responsible. The match validates it (is the
 * player active and in reach? is the object still available?) and either applies
 * it or rejects it with a typed reason; it never trusts the sender.
 */
import type { InteractionResult, PlayerId } from "./state";

interface CommandBase {
  playerId: PlayerId;
  /**
   * Ordering for commands resolved together (see orderCommands): earlier tick first,
   * then lower sequence (arrival order). Optional for commands applied immediately.
   */
  tick?: number;
  sequence?: number;
}

/** USE on an object: the match decides what that means for its kind. */
export interface InteractCommand extends CommandBase {
  type: "interact";
  targetId: string;
}

/** Pick up a pickup object. */
export interface CollectItemCommand extends CommandBase {
  type: "collectItem";
  pickupId: string;
}

export interface SubmitPuzzleAnswerCommand extends CommandBase {
  type: "submitPuzzleAnswer";
  puzzleId: string;
  optionIndex: number;
}

/** Operate a mechanism (currently: doors). */
export interface ActivateObjectCommand extends CommandBase {
  type: "activateObject";
  objectId: string;
}

/**
 * Claim an objective. Accepted only if its condition is met and nobody has been
 * credited yet. Objectives are normally credited automatically to whoever's action
 * completed them; this is for objectives a player reports explicitly.
 */
export interface CompleteObjectiveCommand extends CommandBase {
  type: "completeObjective";
  objectiveId: string;
}

export type GameCommand =
  | InteractCommand
  | CollectItemCommand
  | SubmitPuzzleAnswerCommand
  | ActivateObjectCommand
  | CompleteObjectiveCommand;

export type GameCommandType = GameCommand["type"];

/** Why the match refused a command. Rejections never change state. */
export type RejectReason =
  | "unknownPlayer"
  | "playerNotActive"
  | "matchNotRunning"
  | "unknownTarget"
  | "wrongKind"
  | "outOfReach"
  | "alreadyCollected"
  | "inventoryFull"
  | "alreadyOpen"
  | "alreadySolved"
  | "invalidAnswer"
  | "conditionNotMet"
  | "alreadyCompleted"
  /** Online only: the command couldn't reach the server, or no answer came back in time. */
  | "notConnected";

export type CommandResult =
  | { accepted: true; command: GameCommand; result: InteractionResult; correct?: boolean }
  | { accepted: false; command: GameCommand; reason: RejectReason };
