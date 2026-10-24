import type {
  Interactable,
  ItemDefinition,
  LevelBlock,
  LevelDefinition,
  LevelTheme,
  ObjectiveDefinition,
  PuzzleDefinition,
  TriggerZone,
} from "@/types/game";

import { bush, forestEdge, log, pillar, pine, rock, stump, tree, treeLine } from "./builders";

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
 * Layout (top view, north is up, camera looks from the south). 60 × 68 m, ringed by forest.
 *
 *   z=-34 ┌──────────────────── forest edge ────────────────────┐
 *         │ ▓▓▓▓▓▓▓▓▓▓▓▓ ║   ┌─ shrine ─┐   ║ ▓▓▓▓▓▓▓▓▓▓▓▓ │
 *         │ ▓▓ grove ▓▓▓ ║ ▪     ◎ exit    ▪ ║ ▓▓▓ grove ▓▓ │
 *         │ ▓▓▓▓▓▓▓▓▓▓▓▓ ║ ^^^^ spike trap ^^^^ ║ ▓▓▓▓▓▓▓▓▓▓▓▓ │  ← z ∈ [-20.5, -17.5], wall to wall
 *         │ ▓▓▓▓▓▓▓▓▓▓▓▓ ║ ▪   ruined courtyard  ▪ ║ ▓▓▓▓▓▓▓▓▓▓▓▓ │
 *         │ ▓▓▓▓▓▓▓▓▓▓▓▓ ║    + checkpoint     ║ ▓▓▓▓▓▓▓▓▓▓▓▓ │
 *   z=-8  │ ▓▓▓▓ thicket ▓▓▓▓▓▓ ══╡DOOR╞══ ▓▓▓▓▓▓ thicket ▓▓▓▓ │  ← stone gate in a wall of trees
 *         │                      ☼ sun dial                    │
 *         │   ▤ tablet          open woodland:                 │
 *         │   (ruined pillars)  trees, pines, rocks,           │
 *         │                     bushes, logs, stumps     ⚷ key │  ← hidden among boulders
 *         │                      ● spawn                       │
 *   z=34  └──────────────────── forest edge ────────────────────┘
 *       x=-30                                                x=30
 *
 * Sequence: find the key → read the clue → solve the sun dial → open the door
 *           → cross the spikes → reach the exit.
 */

const HALF_WIDTH = 30;
const HALF_DEPTH = 34;
/** Depth of the band of trees around the map; the playable area ends this far inside. */
const EDGE_DEPTH = 4;
const INNER_X = HALF_WIDTH - EDGE_DEPTH;
const INNER_NORTH = -HALF_DEPTH + EDGE_DEPTH;

/** The thicket (and the temple gate in it) that cuts the woods off from the courtyard. */
const BARRIER_Z = -8;
const BARRIER_HALF_DEPTH = 2;
const GATEHOUSE_HALF_WIDTH = 6;
const DOOR_HALF_WIDTH = 1.5;
const GATE_WALL_HEIGHT = 2.6;

/** The ruined courtyard behind the gate: x ∈ [-COURT_X, COURT_X]. */
const COURT_X = 12;
const COURT_SOUTH = BARRIER_Z - BARRIER_HALF_DEPTH;

const THEME: LevelTheme = {
  background: "#b7cdb9",
  fog: { near: 22, far: 48 },
  floorColor: "#5f7d3b",
  floorAccent: "#7d6a46",
  blockColors: {
    wall: "#b39b72",
    pillar: "#a38d68",
    crate: "#7a5230",
    tree: "#4f8a3c",
    pine: "#2f6b45",
    rock: "#8d8a80",
    bush: "#5a9a45",
    log: "#7a5534",
    stump: "#8a6440",
  },
  ambient: { sky: "#fff4dc", ground: "#3a4a2a", intensity: 1.1 },
  sun: { color: "#ffe8bd", intensity: 2, position: [8, 14, 6] },
};

const wall = (id: string, minX: number, minZ: number, maxX: number, maxZ: number, height: number): LevelBlock => ({
  id,
  kind: "wall",
  center: { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 },
  size: { x: maxX - minX, z: maxZ - minZ },
  height,
});

/** The forest edge, the thicket with its gate, and the temple courtyard: the parts that shape the level. */
const STRUCTURE: LevelBlock[] = [
  ...forestEdge({ halfWidth: HALF_WIDTH, halfDepth: HALF_DEPTH, depth: EDGE_DEPTH }),

  // Thicket across the map, with a stone gatehouse in the middle. The door fills the gap.
  treeLine("thicket-west", -INNER_X, BARRIER_Z - BARRIER_HALF_DEPTH, -GATEHOUSE_HALF_WIDTH, BARRIER_Z + BARRIER_HALF_DEPTH),
  treeLine("thicket-east", GATEHOUSE_HALF_WIDTH, BARRIER_Z - BARRIER_HALF_DEPTH, INNER_X, BARRIER_Z + BARRIER_HALF_DEPTH),
  wall("gate-wall-west", -GATEHOUSE_HALF_WIDTH, BARRIER_Z - 0.5, -DOOR_HALF_WIDTH, BARRIER_Z + 0.5, GATE_WALL_HEIGHT),
  wall("gate-wall-east", DOOR_HALF_WIDTH, BARRIER_Z - 0.5, GATEHOUSE_HALF_WIDTH, BARRIER_Z + 0.5, GATE_WALL_HEIGHT),

  // Courtyard walls, with old groves behind them.
  wall("court-wall-west", -COURT_X - 1, INNER_NORTH, -COURT_X, COURT_SOUTH, 2.6),
  wall("court-wall-east", COURT_X, INNER_NORTH, COURT_X + 1, COURT_SOUTH, 2.6),
  treeLine("grove-west", -INNER_X, INNER_NORTH, -COURT_X - 1, COURT_SOUTH, 5.5),
  treeLine("grove-east", COURT_X + 1, INNER_NORTH, INNER_X, COURT_SOUTH, 5.5),

  // The shrine around the exit.
  wall("shrine-back", -4.5, INNER_NORTH, 4.5, INNER_NORTH + 1.2, 3.4),
  wall("shrine-west", -4.5, INNER_NORTH + 1.2, -3.5, -25.5, 3),
  wall("shrine-east", 3.5, INNER_NORTH + 1.2, 4.5, -25.5, 3),

  // Ruined pillars and rubble in the courtyard (all clear of the spike strip).
  pillar("pillar-gate-w", -8, -12.5),
  pillar("pillar-gate-e", 8, -12.5),
  pillar("pillar-mid-w", -8, -15.5, 1.2, 1.8),
  pillar("pillar-mid-e", 8, -15.5),
  pillar("pillar-north-w", -8, -23.5),
  pillar("pillar-north-e", 8, -23.5, 1.2, 2),
  rock("rubble-1", -10.6, -11.6, 1.3, 1.1, 0.8),
  rock("rubble-2", 10.4, -14, 1.6, 1.2, 0.9),
  rock("rubble-3", -10.2, -27.4, 1.8, 1.5, 1.1),
  rock("rubble-4", 10.6, -26.2, 1.2, 1.2, 0.7),

  // Cover around the key and the tablet.
  rock("key-rock-1", 17.6, 21.4, 1.5, 2.8, 1.6),
  rock("key-rock-2", 19.8, 19.4, 2.6, 1.4, 1.4),
  log("key-log", 21.9, 18.9, 3.2, "z"),
  bush("key-bush", 17.9, 24, 1.4),
  pillar("tablet-pillar-s", -22.4, 2.4, 1.2, 2.4),
  pillar("tablet-pillar-n", -22.4, 7.6, 1.2, 1.3),
  rock("tablet-rock", -23, 5, 1.2, 2, 1.2),
];

/**
 * The open woodland south of the thicket. Generated once from a fixed seed (keeping a
 * winding path from the spawn to the gate and space around every object clear), then
 * written out here so it can be edited by hand.
 */
const WOODS: LevelBlock[] = [
  rock("wood-rock-1", 11, 9.7, 1.2, 1.2, 0.7),
  pine("wood-pine-1", -12.6, 0.6, 5.6),
  tree("wood-tree-1", -5.3, 21.2, 4.3),
  tree("wood-tree-2", 14.9, 5.3, 4.1),
  rock("wood-rock-2", -22.6, 16.3, 1, 1.2, 0.9),
  pine("wood-pine-2", -9.9, 18.2, 6.5),
  stump("wood-stump-1", 9.6, 26.3, 0.9),
  stump("wood-stump-2", -19.3, -3.3, 0.9),
  tree("wood-tree-3", 19.1, 12.5, 5.3),
  bush("wood-bush-1", -16.7, 18.1, 1.7),
  tree("wood-tree-4", -19.1, 8.9, 4.3),
  rock("wood-rock-3", -16.8, 5.6, 1.1, 0.9, 0.9),
  rock("wood-rock-4", -8.8, -0.6, 1.9, 1.6, 1.8),
  rock("wood-rock-5", -19.2, 12.5, 1, 1.1, 0.7),
  stump("wood-stump-3", 22.7, 24.6, 0.6),
  tree("wood-tree-5", -12.5, 24.6, 5.1),
  bush("wood-bush-2", 19.2, 5.9, 1.6),
  log("wood-log-1", 6.6, 17.9, 2.7, "x", 0.6),
  tree("wood-tree-6", -23.2, 21.7, 4.4),
  tree("wood-tree-7", -17.6, 23, 4.3),
  log("wood-log-2", -21.4, -0.9, 2.6, "z", 0.5),
  pine("wood-pine-3", 6.2, 3.4, 4.9),
  rock("wood-rock-6", 7.7, 22.2, 1.3, 1.5, 0.6),
  log("wood-log-3", -3.2, 2.3, 2.6, "z", 0.6),
  tree("wood-tree-8", -17.3, 27.5, 4.2),
  tree("wood-tree-9", 6.5, 11.5, 3.8),
  rock("wood-rock-7", 4.4, 15, 1.3, 1.3, 0.9),
  log("wood-log-4", -15.6, 14, 3.2, "x", 0.7),
  rock("wood-rock-8", -23.1, 14.1, 1.2, 1.1, 0.7),
  tree("wood-tree-10", -9.7, 5.2, 4.8),
  rock("wood-rock-9", -6.2, 15.8, 1.1, 1.1, 0.6),
  rock("wood-rock-10", 24.4, 26.2, 1.4, 1.4, 0.6),
  tree("wood-tree-11", 21.4, -2.9, 4.4),
  log("wood-log-5", -16, -2.6, 2.7, "z", 0.6),
  pine("wood-pine-4", -2.3, 6.5, 5.9),
  bush("wood-bush-3", 15.9, -1.7, 1.6),
  rock("wood-rock-11", -7.4, 24.8, 1.1, 1, 0.9),
  rock("wood-rock-12", 17.5, 2.8, 1.1, 1.2, 0.7),
  tree("wood-tree-12", 10.5, 18.9, 5.4),
  tree("wood-tree-13", 23.8, 5.2, 4),
  pine("wood-pine-5", 8.2, 8.3, 5.7),
  pine("wood-pine-6", 20.5, 1.2, 6.5),
  tree("wood-tree-14", 1.8, 18.4, 3.8),
  bush("wood-bush-4", 12.3, 1.4, 1.4),
  tree("wood-tree-15", -15, 8.3, 4),
  tree("wood-tree-16", -4.7, -2.5, 4.8),
  tree("wood-tree-17", -10.1, 10.5, 5.2),
  rock("wood-rock-13", 23.1, 7.9, 1.2, 1.1, 0.8),
  rock("wood-rock-14", -17.7, 3.3, 1.1, 0.9, 1),
  tree("wood-tree-18", 9.6, -2, 4.9),
  tree("wood-tree-19", 13.7, 13.8, 4.9),
  stump("wood-stump-4", -11.9, 27.6, 0.7),
  rock("wood-rock-15", 10, 4.3, 1.2, 1.4, 0.7),
  tree("wood-tree-20", 2.2, 12.7, 4.1),
  pine("wood-pine-7", 14, 21.4, 4.9),
  tree("wood-tree-21", 14.8, 10.2, 4.1),
  stump("wood-stump-5", -7.4, 9.2, 0.6),
  pine("wood-pine-8", -6.3, 3.8, 4.9),
  stump("wood-stump-6", -21.2, 25.8, 0.8),
  pine("wood-pine-9", -5.2, 27.1, 5.2),
  bush("wood-bush-5", 9.6, 13.2, 1.3),
  pine("wood-pine-10", -10.6, 14.4, 5.2),
  pine("wood-pine-11", 12.8, -3.7, 4.8),
  log("wood-log-6", 6.8, 26.2, 2.4, "x", 0.7),
  stump("wood-stump-7", 23.2, 22.3, 0.9),
  tree("wood-tree-22", 12.4, 27.4, 4.9),
  pine("wood-pine-12", 17.2, 15.9, 5.2),
  tree("wood-tree-23", -13.3, 4.9, 4.1),
  pine("wood-pine-13", -23.5, 27.4, 5.1),
  rock("wood-rock-16", 17.2, -4.1, 1.1, 0.9, 0.7),
  tree("wood-tree-24", -5.4, 12.2, 4.2),
  tree("wood-tree-25", 18.4, 27.2, 5.2),
  stump("wood-stump-8", -7.8, 22.2, 0.6),
  pine("wood-pine-14", 23.4, 11.4, 5.7),
  bush("wood-bush-6", -24.4, -0.4, 1.2),
  tree("wood-tree-26", -20.4, 18.9, 3.9),
  rock("wood-rock-17", 21.3, 28.5, 1.2, 1.1, 0.7),
  tree("wood-tree-27", 11, 24, 4.1),
  bush("wood-bush-7", -11.4, -4.1, 1.1),
];

const BRONZE_KEY: ItemDefinition = { id: TEMPLE_IDS.bronzeKeyItem, name: "Bronze Key" };

const interactables: Interactable[] = [
  {
    id: TEMPLE_IDS.key,
    kind: "pickup",
    // Hidden among the boulders in the south-east of the woods.
    position: { x: 19.6, z: 21.6 },
    facing: 0,
    reach: 1.2,
    prompt: "Pick up",
    item: BRONZE_KEY,
  },
  {
    id: TEMPLE_IDS.tablet,
    kind: "inspect",
    // Among ruined pillars in the west of the woods, facing east.
    position: { x: -21.6, z: 5 },
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
    position: { x: 5.5, z: -3.4 },
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
    position: { x: 0, z: BARRIER_Z },
    facing: 0,
    reach: 1.8,
    // Fills the gap in the gatehouse exactly, so it blocks the way until opened.
    collider: { x: DOOR_HALF_WIDTH * 2, z: 0.6 },
    prompt: "Open",
    width: DOOR_HALF_WIDTH * 2,
    height: GATE_WALL_HEIGHT,
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
    wrongAnswerHint: "The dial clicks back into place. Perhaps something in the woods holds a hint.",
    solvedNotice: "The seal of the suns breaks!",
  },
];

const triggers: TriggerZone[] = [
  {
    id: TEMPLE_IDS.spikeTrap,
    kind: "trap",
    // Wall to wall across the courtyard: there is no way around it, only timing.
    center: { x: 0, z: -19 },
    size: { x: COURT_X * 2, z: 3 },
    // 3.6 s cycle; dangerous for about a third of it.
    timing: { hidden: 1.8, warning: 0.5, rising: 0.1, armed: 0.9, retracting: 0.3 },
    respawnPointId: TEMPLE_IDS.northCheckpoint,
    hitMessage: "The spikes got you! Back to the checkpoint.",
  },
  {
    id: TEMPLE_IDS.exit,
    kind: "exit",
    center: { x: 0, z: -27 },
    size: { x: 3, z: 1.6 },
  },
];

const objectives: ObjectiveDefinition[] = [
  {
    id: "find-key",
    text: "Search the woods for the temple key",
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
    text: "Set the sun dial by the gate to break the seal",
    completeWhen: { kind: "puzzleSolved", puzzleId: TEMPLE_IDS.sunPuzzle },
  },
  {
    id: "open-door",
    text: "Open the temple door",
    completeWhen: { kind: "doorOpened", doorId: TEMPLE_IDS.door },
  },
  {
    id: "escape",
    text: "Cross the spikes and reach the shrine",
    completeWhen: { kind: "levelCompleted" },
  },
];

export const templeLevel: LevelDefinition = {
  id: TEMPLE_IDS.level,
  name: "Forgotten Temple",
  description: "Search the woods for the key, crack the sun dial and dodge the spikes.",

  floorSize: { x: HALF_WIDTH * 2, z: HALF_DEPTH * 2 },
  blocks: [...STRUCTURE, ...WOODS],
  theme: THEME,

  spawnPoints: [
    // Models face +z at angle 0; π turns the player to face north, toward the temple.
    { id: TEMPLE_IDS.start, position: { x: 0, z: 25 }, facing: Math.PI },
    // Just through the door: the trap sends you back here, not to the very start.
    { id: TEMPLE_IDS.northCheckpoint, position: { x: 0, z: -11.6 }, facing: Math.PI },
  ],
  playerSpawnId: TEMPLE_IDS.start,

  interactables,
  triggers,
  puzzles,
  objectives,

  // No time limit; default scoring (3:00 par time).
  nextLevelId: "cloister-2",
};

