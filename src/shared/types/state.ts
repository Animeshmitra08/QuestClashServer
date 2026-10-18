/**
 * Runtime state types: what has happened so far in a match.
 *
 * MatchState is immutable: every change produces a new object, which is what
 * React needs to re-render the HUD. It holds things that change at human speed.
 * Per-frame data (each player's position, spike height) lives in mutable objects
 * outside React (see PlayerState in ./game.ts, TrapState below).
 *
 * The state is split in two, and every rule says which half it touches:
 *  - shared: the match and the world, the same for everyone (MatchState minus `players`)
 *  - personal: one entry per player in `players` (MatchPlayer)
 * See docs/MULTIPLAYER.md for the ownership rules.
 */
import type { ItemDefinition, MessageContent, PuzzleDefinition, SpawnPoint, TrapPhase } from "./game";

export type { TrapPhase };

/** Stable id for a player for the whole match (e.g. an account id later). Never reused within a match. */
export type PlayerId = string;

// --- State machines ------------------------------------------------------------

/** Match flow: playing ⇄ paused; playing → completed or failed (both final). */
export type LevelStatus = "playing" | "paused" | "completed" | "failed";
export type LevelEvent = "pause" | "resume" | "complete" | "fail";
export type FailReason = "timeUp" | "allEliminated";

/**
 * A player's own flow: active → eliminated | escaped | left (all final).
 * Only active players can act or trigger anything.
 */
export type PlayerStatus = "active" | "eliminated" | "escaped" | "left";
export type PlayerEvent = "eliminate" | "escape" | "leave";

/** unsolved → solved. Wrong answers stay unsolved but are counted. */
export type PuzzleStatus = "unsolved" | "solved";
export type PuzzleEvent = "answerCorrect" | "answerWrong";

export interface PuzzleState {
  status: PuzzleStatus;
  /** Wrong answers from everyone. Each player's own count is in MatchPlayer. */
  wrongAttempts: number;
  solvedBy: PlayerId | null;
}

/** locked → open. Opening needs every one of the door's requirements. */
export type DoorStatus = "locked" | "open";
export type DoorEvent = "unlock";

export interface DoorState {
  status: DoorStatus;
  openedBy: PlayerId | null;
}

/** Why a locked door didn't open. */
export type DoorBlockReason = "missingItem" | "puzzleUnsolved";

/** Per-frame trap state, read by the renderer. Mutable; never React state. */
export interface TrapState {
  readonly phase: TrapPhase;
  /** Spike offset from the floor: 0 = fully up, negative = sunk below the floor. */
  readonly height: number;
  /** True while touching the trap hurts. */
  readonly lethal: boolean;
}

// --- Match state -----------------------------------------------------------------

/** A short message that pops up over the game for a moment, for one player. */
export interface Notice {
  /** Increases with every notice, so the UI can tell two identical texts apart. */
  id: number;
  text: string;
  tone: "info" | "success" | "danger";
}

/** Personal state: one player's place in the match. */
export interface MatchPlayer {
  id: PlayerId;
  name: string;
  /** 0–4, assigned on joining; picks the spawn position and colour. */
  slot: number;
  status: PlayerStatus;
  /** Items this player carries. Only the holder can use them. */
  inventory: readonly ItemDefinition[];
  /** Clues this player has read. Clues are personal knowledge. */
  inspectedIds: readonly string[];
  /** null = unlimited. At 0 the player is eliminated. */
  livesRemaining: number | null;
  trapHits: number;
  wrongAnswers: number;
  notice: Notice | null;
}

/** The shared world: the same for every player. */
export interface WorldState {
  /** Pickups removed from the world → who took them. Kept after the item is used up. */
  collectedPickups: Readonly<Record<string, PlayerId>>;
  puzzles: Readonly<Record<string, PuzzleState>>;
  doors: Readonly<Record<string, DoorState>>;
  /** Objectives done → the player whose action completed them (null if no single player did). */
  completedObjectives: Readonly<Record<string, PlayerId | null>>;
}

export interface MatchState {
  status: LevelStatus;
  failReason: FailReason | null;
  /**
   * Play time. While playing it is published in whole seconds only, so the HUD
   * re-renders once per second rather than every frame. Exact once finished.
   */
  elapsedSeconds: number;
  world: WorldState;
  players: Readonly<Record<PlayerId, MatchPlayer>>;
  /** Join order; the order players are listed and processed in. */
  playerOrder: readonly PlayerId[];
}

// --- Results and events ----------------------------------------------------------

/** What the acting player's screen should show after using something. */
export type InteractionResult =
  | { type: "none" }
  | ({ type: "message" } & MessageContent)
  | { type: "puzzle"; puzzle: PuzzleDefinition };

/** What the scene must do after a frame of match logic. */
export interface FrameResult {
  /** Players to move (after a trap hit), by id. */
  respawns: Readonly<Record<PlayerId, SpawnPoint>>;
}

/**
 * Something that happened, for listeners such as AudioManager. Events describe
 * facts; they don't change state. `playerId` is the player responsible.
 */
export type GameEvent =
  | { type: "playerJoined"; playerId: PlayerId }
  | { type: "playerLeft"; playerId: PlayerId }
  | { type: "playerEliminated"; playerId: PlayerId }
  | { type: "playerEscaped"; playerId: PlayerId }
  | { type: "itemCollected"; playerId: PlayerId; item: ItemDefinition; pickupId: string }
  | { type: "itemUsed"; playerId: PlayerId; item: ItemDefinition }
  | { type: "itemsReturned"; playerId: PlayerId; pickupIds: string[] }
  | { type: "inspected"; playerId: PlayerId; interactableId: string; firstTime: boolean }
  | { type: "puzzleOpened"; playerId: PlayerId; puzzleId: string }
  | { type: "puzzleSolved"; playerId: PlayerId; puzzleId: string }
  | { type: "puzzleFailed"; playerId: PlayerId; puzzleId: string }
  | { type: "doorOpened"; playerId: PlayerId; doorId: string }
  | { type: "doorBlocked"; playerId: PlayerId; doorId: string; reason: DoorBlockReason }
  | { type: "objectiveCompleted"; playerId: PlayerId | null; objectiveId: string }
  | { type: "trapHit"; playerId: PlayerId; trapId: string }
  | { type: "exitLocked"; playerId: PlayerId; exitId: string }
  | { type: "commandRejected"; playerId: PlayerId; command: string; reason: string }
  | { type: "levelPaused" }
  | { type: "levelResumed" }
  | { type: "levelCompleted"; elapsedSeconds: number }
  | { type: "levelFailed"; reason: FailReason };

export type GameEventType = GameEvent["type"];
