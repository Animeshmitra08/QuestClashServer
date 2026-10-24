/**
 * Level data types: everything that describes a level and never changes during play.
 * Runtime state (what has happened so far) lives in ./state.ts.
 *
 * World axes (Three.js convention):
 *   x → right, y → up, z → toward the camera ("south").
 * The level is a flat floor at y = 0, so most gameplay math only needs x and z.
 *
 * IDs: every block, interactable and trigger in a level has an `id` that is unique
 * across all three (they share the collision namespace). Puzzles, items and
 * objectives each have their own namespace. `validateLevel` checks all of this.
 */

/** A point or direction on the floor plane. */
export interface Vec2 {
  x: number;
  z: number;
}

/**
 * Stick deflection from the virtual joystick, each axis in [-1, 1].
 * x → right, y → up (away from the player's thumb). Length is at most 1.
 */
export interface JoystickVector {
  x: number;
  y: number;
}

/** Everything the game needs to know about the player each frame. Mutable; never React state. */
export interface PlayerState {
  position: Vec2;
  velocity: Vec2;
  /** Rotation around the y axis, in radians. 0 = facing +z (toward the camera). */
  facing: number;
  /** Current speed as a fraction of max speed, 0..1. Drives the walk animation. */
  moveAmount: number;
  /** Game time (seconds) of the last interaction press, or -Infinity if never. */
  lastInteractTime: number;
  /** Seconds of gameplay since the stage started. */
  time: number;
}

/**
 * What a solid block looks like. Every kind collides as its rectangle (`center`, `size`);
 * the kind only changes the model drawn there.
 *
 * - Built stone and wood, drawn as boxes filling the rectangle: "wall", "pillar", "crate".
 * - Nature, drawn as low-poly models:
 *   - "tree" (round, leafy) and "pine": the rectangle is the trunk you bump into (about
 *     0.8 × 0.8); the crown spreads wider overhead. `height` is the whole tree.
 *   - "rock", "bush", "stump": the model fills the rectangle, `height` tall.
 *   - "log": a fallen trunk lying along the rectangle's longer side; `height` is its thickness.
 *   - "treeline": a dense band of trees filling the rectangle, for the edge of the map or a
 *     thicket nobody can pass. `height` is the typical tree height.
 */
export type BlockKind = "wall" | "pillar" | "crate" | "tree" | "pine" | "rock" | "bush" | "log" | "stump" | "treeline";

/** An axis-aligned rectangle on the floor plane. */
export interface Rect {
  /** Center of the rectangle on the floor plane. */
  center: Vec2;
  /** Full width (x) and depth (z). */
  size: Vec2;
}

/** A rectangle the player cannot walk through. */
export interface CollisionBox extends Rect {
  id: string;
}

/**
 * A solid, axis-aligned box standing on the floor.
 * The same data is used to draw the box and for collision.
 */
export interface LevelBlock extends CollisionBox {
  kind: BlockKind;
  /** Height above the floor. */
  height: number;
}

/** A position plus the direction to face there. */
export interface SpawnPoint {
  position: Vec2;
  facing: number;
}

/** A named place the player can (re)appear: the start, a checkpoint… */
export interface SpawnPointDefinition extends SpawnPoint {
  id: string;
}

/** Title and body text for a message panel. */
export interface MessageContent {
  title: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export interface ItemDefinition {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Interactables: things the USE button acts on.
// Adding a new kind: add an interface here, a handler in systems/interactionRules.ts
// (TypeScript will insist), and a model in game/Interactables.tsx.
// ---------------------------------------------------------------------------

interface InteractableBase {
  id: string;
  position: Vec2;
  /** Visual rotation around the y axis, in radians. */
  facing: number;
  /** How close (center to center) the player must be to use it. */
  reach: number;
  /** Short verb shown on the USE button while this is in reach (in capitals), e.g. "Read". Keep it to one or two short words. */
  prompt: string;
  /** Footprint size if the object is solid; omit for objects the player can walk over. */
  collider?: Vec2;
}

/** Something the player can examine; shows a message. */
export interface InspectInteractable extends InteractableBase, MessageContent {
  kind: "inspect";
}

/** An item lying in the world that goes into the inventory when used. */
export interface PickupInteractable extends InteractableBase {
  kind: "pickup";
  item: ItemDefinition;
}

/** One condition a door needs before it opens, with what to say when it isn't met. */
export type DoorRequirement =
  | {
      kind: "item";
      itemId: string;
      /** True if opening the door uses the item up (removes it from the inventory). */
      consume: boolean;
      blockedMessage: MessageContent;
    }
  | {
      kind: "puzzle";
      puzzleId: string;
      blockedMessage: MessageContent;
    };

/** A door that opens once all its requirements are met. */
export interface DoorInteractable extends InteractableBase {
  kind: "door";
  /** Checked in order; the first unmet one's message is shown. Empty = opens on use. */
  requirements: DoorRequirement[];
  /** Door panel size: width along its face, and height. Thickness comes from `collider`. */
  width: number;
  height: number;
}

/** A mechanism that asks the player a question. */
export interface PuzzleInteractable extends InteractableBase {
  kind: "puzzle";
  puzzleId: string;
  /** Shown when used again after the puzzle is solved. */
  solvedMessage: MessageContent;
}

export type Interactable =
  | InspectInteractable
  | PickupInteractable
  | DoorInteractable
  | PuzzleInteractable;

export type InteractableKind = Interactable["kind"];

// ---------------------------------------------------------------------------
// Triggers: areas that react when the player steps into them.
// ---------------------------------------------------------------------------

/**
 * Spike trap cycle, in order: hidden → warning → rising → armed → retracting → hidden…
 * During "warning" the tips peek out and rattle; it is harmless.
 */
export type TrapPhase = "hidden" | "warning" | "rising" | "armed" | "retracting";

/** Seconds spent in each phase of the cycle. */
export type TrapTiming = Readonly<Record<TrapPhase, number>>;

export interface TrapTrigger extends Rect {
  id: string;
  kind: "trap";
  timing: TrapTiming;
  /** Seconds into the cycle at stage start, to stagger several traps. */
  startOffset?: number;
  /** Id of the spawn point a hit sends the player to. */
  respawnPointId: string;
  hitMessage: string;
}

export interface ExitTrigger extends Rect {
  id: string;
  kind: "exit";
  /** The exit only works once this is true. Omit for an always-open exit. */
  requires?: ObjectiveCondition;
  /** Pop-up shown when the player steps in before `requires` is met. */
  lockedMessage?: string;
}

export type TriggerZone = TrapTrigger | ExitTrigger;

// ---------------------------------------------------------------------------
// Puzzles and objectives
// ---------------------------------------------------------------------------

/** A multiple-choice question; multiple choice is far easier than typing on a phone. */
export interface PuzzleDefinition {
  id: string;
  title: string;
  question: string;
  options: string[];
  correctOptionIndex: number;
  /** Shown after a wrong answer. */
  wrongAnswerHint: string;
  /** Pop-up shown when solved. */
  solvedNotice: string;
}

/** A fact about progress that an objective waits for. */
export type ObjectiveCondition =
  | { kind: "pickupCollected"; pickupId: string }
  | { kind: "inspected"; interactableId: string }
  | { kind: "puzzleSolved"; puzzleId: string }
  | { kind: "doorOpened"; doorId: string }
  | { kind: "levelCompleted" }
  /** Done when any of these is true (e.g. "find the clue" also counts as done once the puzzle is solved). */
  | { kind: "any"; of: ObjectiveCondition[] };

export interface ObjectiveDefinition {
  id: string;
  text: string;
  completeWhen: ObjectiveCondition;
}

// ---------------------------------------------------------------------------
// Scoring, look and assets
// ---------------------------------------------------------------------------

/** How a level is scored. Levels override only what they need (see DEFAULT_SCORING). */
export interface ScoringRules {
  itemFound: number;
  clueRead: number;
  puzzleSolved: number;
  doorOpened: number;
  exitReached: number;
  perTrapHit: number;
  perWrongAnswer: number;
  /** Finishing faster than this earns a bonus; slower earns none. */
  parTimeSeconds: number;
  timeBonusPerSecond: number;
  /** Minimum final score for 1, 2 and 3 stars, in increasing order. */
  starThresholds: readonly [number, number, number];
}

/** Colours and lights. Rendering reads this; gameplay never does. */
export interface LevelTheme {
  /** Background and fog colour. */
  background: string;
  fog: { near: number; far: number };
  floorColor: string;
  /** A second floor colour blended in soft patches (grass and bare earth, moss…). Omit for an even floor. */
  floorAccent?: string;
  /**
   * Colour per block kind. Kinds left out use a natural default (green leaves, grey rock…).
   * For trees, pines and treelines this is the colour of the leaves; trunks are always bark brown.
   */
  blockColors: Readonly<Partial<Record<BlockKind, string>>>;
  ambient: { sky: string; ground: string; intensity: number };
  sun: { color: string; intensity: number; position: readonly [number, number, number] };
}

/**
 * Optional art for a level, as keys into the asset registry (src/levels/assets.ts).
 * Missing or unknown keys fall back to plain colours, so a level is always playable.
 */
export interface LevelAssets {
  floorTexture?: string;
}

// ---------------------------------------------------------------------------
// The level itself
// ---------------------------------------------------------------------------

export interface LevelDefinition {
  id: string;
  name: string;
  /** One line shown on the start screen. */
  description: string;

  // Map
  /** Size of the floor plane (x by z), centered on the origin. */
  floorSize: Vec2;
  blocks: LevelBlock[];
  theme: LevelTheme;
  assets?: LevelAssets;

  // Spawning
  spawnPoints: SpawnPointDefinition[];
  /** Id of the spawn point where the player starts. */
  playerSpawnId: string;

  // Gameplay content
  interactables: Interactable[];
  triggers: TriggerZone[];
  puzzles: PuzzleDefinition[];
  /** In the intended order. The HUD shows the first one not yet done. */
  objectives: ObjectiveDefinition[];

  // Rules
  /** Running out of time fails the level. Omit for no limit. */
  timeLimitSeconds?: number;
  /** Overrides for DEFAULT_SCORING. */
  scoring?: Partial<ScoringRules>;
  /** Level that "Next level" leads to after completion, or null if this is the last one. */
  nextLevelId: string | null;
}
