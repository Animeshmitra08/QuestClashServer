import type {
  Interactable,
  ItemDefinition,
  LevelDefinition,
  LevelTheme,
  ObjectiveDefinition,
  PuzzleDefinition,
  TriggerZone,
} from "@/types/game";

import { crate, outerWalls, pillar, WALL_THICKNESS, wallWithGap } from "./builders";

/**
 * Stable ids for everything the rules or objectives refer to. Change an
 * id here and every reference follows; validateLevel catches anything left dangling.
 */
export const TEMPLE_IDS = {
  level: "temple-1",
  key: "key",
  tablet: "tablet-clue",
  sunDial: "sun-dial",
  door: "temple-door",
  spikeTrap: "spike-trap",
  exit: "exit",
  sunPuzzle: "sun-dial-puzzle",
  bronzeKeyItem: "bronze-key",
  start: "start",
  northCheckpoint: "north-checkpoint",
} as const;

/**
 * Layout (top view, north is up, camera looks from the south):
 *
 *   z=-14 ┌───────────── north wall ─────────────┐
 *         │                 ◎ exit                │
 *         │ ^^^^^^^^^^^^ spike trap ^^^^^^^^^^^^^ │  ← z ∈ [-9, -7], timed spikes
 *         │     ▪                         ▪       │
 *         │              + checkpoint             │
 *   z=-3  ├──────────────┐ DOOR ┌────────────────┤  ← locked door fills the gap x ∈ [-1.5, 1.5]
 *         │                         ☼ sun dial    │
 *         │   ▪              ▪                    │
 *         │ ▤ tablet (clue)                       │
 *         │   ▪              ▪                    │
 *         │               ● spawn      ▫▫ crates  │
 *   z=14  └────────── low south wall ──────── ⚷ ─┘  ← key hidden behind the crates
 *       x=-10                                  x=10
 *
 * Sequence: find the key → read the clue → solve the sun dial → open the door
 *           → cross the spikes → reach the exit.
 */

const HALF_WIDTH = 10;
const HALF_DEPTH = 14;
const INNER_HALF_WIDTH = HALF_WIDTH - WALL_THICKNESS;
const INNER_WALL_HEIGHT = 2.4;
const DOOR_HALF_WIDTH = 1.5;
const INNER_WALL_Z = -3;

const THEME: LevelTheme = {
  background: "#1b1712",
  fog: { near: 18, far: 40 },
  floorColor: "#6e6253",
  blockColors: { wall: "#b39b72", pillar: "#9c8660", crate: "#7a5230" },
  ambient: { sky: "#fff1d6", ground: "#3a2f22", intensity: 1.2 },
  sun: { color: "#ffe2b0", intensity: 2, position: [6, 12, 4] },
};

const BRONZE_KEY: ItemDefinition = { id: TEMPLE_IDS.bronzeKeyItem, name: "Bronze Key" };

const interactables: Interactable[] = [
  {
    id: TEMPLE_IDS.key,
    kind: "pickup",
    // Tucked behind the crates in the south-east corner.
    position: { x: 8.2, z: 12.2 },
    facing: 0,
    reach: 1.2,
    prompt: "Pick up",
    item: BRONZE_KEY,
  },
  {
    id: TEMPLE_IDS.tablet,
    kind: "inspect",
    // Against the west wall (inner face at x = -9), facing east into the room.
    position: { x: -8.2, z: 4 },
    facing: Math.PI / 2,
    reach: 1.6,
    collider: { x: 0.5, z: 1.1 },
    prompt: "Read",
    title: "Weathered Tablet",
    message: "Three suns rise over the temple gate.\nOnly those who remember their number may pass.",
  },
  {
    id: TEMPLE_IDS.sunDial,
    kind: "puzzle",
    position: { x: 3.4, z: -1.2 },
    facing: Math.PI,
    reach: 1.5,
    collider: { x: 0.9, z: 0.9 },
    prompt: "Inspect",
    puzzleId: TEMPLE_IDS.sunPuzzle,
    solvedMessage: {
      title: "The Sun Dial",
      message: "The dial is locked in place. Its seal is already broken.",
    },
  },
  {
    id: TEMPLE_IDS.door,
    kind: "door",
    position: { x: 0, z: INNER_WALL_Z },
    facing: 0,
    reach: 1.8,
    // Fills the gap in the inner wall exactly, so it blocks the way until opened.
    collider: { x: DOOR_HALF_WIDTH * 2, z: 0.6 },
    prompt: "Open",
    width: DOOR_HALF_WIDTH * 2,
    height: INNER_WALL_HEIGHT,
    requirements: [
      {
        kind: "item",
        itemId: BRONZE_KEY.id,
        consume: true,
        blockedMessage: {
          title: "Locked Door",
          message: "A heavy stone door with a bronze keyhole. It won't move without a key.",
        },
      },
      {
        kind: "puzzle",
        puzzleId: TEMPLE_IDS.sunPuzzle,
        blockedMessage: {
          title: "Sealed Door",
          message:
            "The key turns, but an ancient seal still holds the door shut. The sun dial nearby might release it.",
        },
      },
    ],
  },
];

const puzzles: PuzzleDefinition[] = [
  {
    id: TEMPLE_IDS.sunPuzzle,
    title: "The Sun Dial",
    question: "The dial has a ring of sun symbols. How many suns must you set?",
    options: ["One", "Two", "Three", "Four"],
    correctOptionIndex: 2,
    wrongAnswerHint: "The dial clicks back into place. Perhaps something in the temple holds a hint.",
    solvedNotice: "The seal of the suns breaks!",
  },
];

const triggers: TriggerZone[] = [
  {
    id: TEMPLE_IDS.spikeTrap,
    kind: "trap",
    // A full-width strip: there is no way around it, only timing.
    center: { x: 0, z: -8 },
    size: { x: INNER_HALF_WIDTH * 2, z: 2 },
    // 3.6 s cycle; dangerous for about a third of it.
    timing: { hidden: 1.8, warning: 0.5, rising: 0.1, armed: 0.9, retracting: 0.3 },
    respawnPointId: TEMPLE_IDS.northCheckpoint,
    hitMessage: "The spikes got you! Back to the checkpoint.",
  },
  {
    id: TEMPLE_IDS.exit,
    kind: "exit",
    center: { x: 0, z: -12.2 },
    size: { x: 3, z: 1.6 },
  },
];

const objectives: ObjectiveDefinition[] = [
  {
    id: "find-key",
    text: "Find the key to the temple door",
    completeWhen: { kind: "pickupCollected", pickupId: TEMPLE_IDS.key },
  },
  {
    id: "find-clue",
    text: "Find a clue to the sun dial",
    // Solving the dial without reading the clue also moves the player on.
    completeWhen: {
      kind: "any",
      of: [
        { kind: "inspected", interactableId: TEMPLE_IDS.tablet },
        { kind: "puzzleSolved", puzzleId: TEMPLE_IDS.sunPuzzle },
      ],
    },
  },
  {
    id: "solve-dial",
    text: "Set the sun dial to break the seal",
    completeWhen: { kind: "puzzleSolved", puzzleId: TEMPLE_IDS.sunPuzzle },
  },
  {
    id: "open-door",
    text: "Open the temple door",
    completeWhen: { kind: "doorOpened", doorId: TEMPLE_IDS.door },
  },
  {
    id: "escape",
    text: "Cross the spikes and reach the exit",
    completeWhen: { kind: "levelCompleted" },
  },
];

export const templeLevel: LevelDefinition = {
  id: TEMPLE_IDS.level,
  name: "Forgotten Temple",
  description: "Find the key, crack the sun dial and dodge the spikes.",

  floorSize: { x: HALF_WIDTH * 2 + 2, z: HALF_DEPTH * 2 + 2 },
  blocks: [
    ...outerWalls({ halfWidth: HALF_WIDTH, halfDepth: HALF_DEPTH }),
    ...wallWithGap({
      id: "wall-inner",
      z: INNER_WALL_Z,
      innerHalfWidth: INNER_HALF_WIDTH,
      gapHalfWidth: DOOR_HALF_WIDTH,
      height: INNER_WALL_HEIGHT,
    }),
    pillar("pillar-sw", -5, 7),
    pillar("pillar-se", 5, 7),
    pillar("pillar-nw", -5, 1),
    pillar("pillar-ne", 5, 1),
    pillar("pillar-north-w", -5.5, -5.2),
    pillar("pillar-north-e", 5.5, -5.2),
    crate("crate-1", 7, 11),
    crate("crate-2", 7.6, 9.8, 0.8),
    crate("crate-3", -7.2, -0.8),
  ],
  theme: THEME,

  spawnPoints: [
    // Models face +z at angle 0; π turns the player to face north, into the temple.
    { id: TEMPLE_IDS.start, position: { x: 0, z: 10 }, facing: Math.PI },
    // Just through the door: the trap sends you back here, not to the very start.
    { id: TEMPLE_IDS.northCheckpoint, position: { x: 0, z: -4.6 }, facing: Math.PI },
  ],
  playerSpawnId: TEMPLE_IDS.start,

  interactables,
  triggers,
  puzzles,
  objectives,

  // No time limit; default scoring (3:00 par time).
  nextLevelId: "cloister-2",
};
