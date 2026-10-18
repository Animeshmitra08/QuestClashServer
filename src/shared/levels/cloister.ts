import type { LevelDefinition, TrapTiming } from "@/types/game";

import { crate, outerWalls, pillar, WALL_THICKNESS, wallWithGap } from "./builders";

/**
 * A second, smaller level built only from configuration. It uses features the
 * temple doesn't: a key-only door, an exit locked behind a puzzle, two staggered
 * traps, a time limit, its own scoring and a floor texture asset.
 *
 *   z=-10 ┌──────── north wall ────────┐
 *         │           ◎ moon gate       │  ← exit, opens once the altar is answered
 *         │ ^^^^^^^ far spikes ^^^^^^^^ │  ← z ∈ [-7.2, -6.0]
 *         │  ☾ altar                    │  ← safe band between the traps
 *         │ ^^^^^^^ near spikes ^^^^^^^ │  ← z ∈ [-4.0, -2.8], out of sync with the far ones
 *         │          + gate checkpoint  │
 *   z=-1  ├───────────┐GATE┌────────────┤  ← needs the silver key
 *         │   ▪                  ▪   ▤  │  ← tablet (clue) on the east wall
 *         │ ▫                           │
 *         │ ⚷ ▫        ● spawn          │  ← key tucked behind crates, reached from the south
 *   z=10  └──────── low south wall ─────┘
 *       x=-8                          x=8
 */
export const CLOISTER_IDS = {
  level: "cloister-2",
  key: "moon-key",
  silverKeyItem: "silver-key",
  tablet: "moon-tablet",
  altar: "moon-altar",
  gate: "cloister-gate",
  nearSpikes: "spikes-near",
  farSpikes: "spikes-far",
  exit: "moon-gate",
  moonPuzzle: "moon-puzzle",
  start: "start",
  gateCheckpoint: "gate-checkpoint",
} as const;

const HALF_WIDTH = 8;
const HALF_DEPTH = 10;
const INNER_HALF_WIDTH = HALF_WIDTH - WALL_THICKNESS;
const GATE_Z = -1;
const GATE_HALF_WIDTH = 1.25;
const INNER_WALL_HEIGHT = 2.2;

/** Shorter cycle than the temple: 2.8 s, two traps half a cycle apart. */
const SPIKE_TIMING: TrapTiming = { hidden: 1.2, warning: 0.4, rising: 0.1, armed: 0.8, retracting: 0.3 };

export const cloisterLevel: LevelDefinition = {
  id: CLOISTER_IDS.level,
  name: "Moonlit Cloister",
  description: "Two sets of spikes, a moon altar, and two minutes on the clock.",

  floorSize: { x: HALF_WIDTH * 2 + 2, z: HALF_DEPTH * 2 + 2 },
  blocks: [
    ...outerWalls({ halfWidth: HALF_WIDTH, halfDepth: HALF_DEPTH }),
    ...wallWithGap({
      id: "wall-inner",
      z: GATE_Z,
      innerHalfWidth: INNER_HALF_WIDTH,
      gapHalfWidth: GATE_HALF_WIDTH,
      height: INNER_WALL_HEIGHT,
    }),
    pillar("pillar-w", -3.5, 3),
    pillar("pillar-e", 3.5, 3),
    crate("crate-a", -4.6, 7.3),
    crate("crate-b", -6, 6, 0.8),
  ],
  theme: {
    background: "#0f1420",
    fog: { near: 14, far: 32 },
    floorColor: "#3a4250",
    blockColors: { wall: "#6b7385", pillar: "#5a6274", crate: "#4a3a2a" },
    ambient: { sky: "#c8d6ff", ground: "#1a1e2a", intensity: 1 },
    sun: { color: "#b8c8ff", intensity: 1.6, position: [-5, 12, 6] },
  },
  assets: { floorTexture: "cloister-floor" },

  spawnPoints: [
    { id: CLOISTER_IDS.start, position: { x: 0, z: 7 }, facing: Math.PI },
    { id: CLOISTER_IDS.gateCheckpoint, position: { x: 0, z: -2.1 }, facing: Math.PI },
  ],
  playerSpawnId: CLOISTER_IDS.start,

  interactables: [
    {
      id: CLOISTER_IDS.key,
      kind: "pickup",
      position: { x: -6, z: 7.6 },
      facing: 0,
      reach: 1.2,
      prompt: "Pick up",
      item: { id: CLOISTER_IDS.silverKeyItem, name: "Silver Key" },
    },
    {
      id: CLOISTER_IDS.tablet,
      kind: "inspect",
      // Against the east wall (inner face at x = 7), facing west into the room.
      position: { x: 6.2, z: 2 },
      facing: -Math.PI / 2,
      reach: 1.6,
      collider: { x: 0.5, z: 1.1 },
      prompt: "Read",
      title: "Moonlit Tablet",
      message: "Two pale moons keep watch over the cloister.\nSpeak their number at the altar.",
    },
    {
      id: CLOISTER_IDS.gate,
      kind: "door",
      position: { x: 0, z: GATE_Z },
      facing: 0,
      reach: 1.8,
      collider: { x: GATE_HALF_WIDTH * 2, z: 0.6 },
      prompt: "Open",
      width: GATE_HALF_WIDTH * 2,
      height: INNER_WALL_HEIGHT,
      requirements: [
        {
          kind: "item",
          itemId: CLOISTER_IDS.silverKeyItem,
          consume: true,
          blockedMessage: {
            title: "Cloister Gate",
            message: "An iron gate with a silver lock. Somewhere in this courtyard is its key.",
          },
        },
      ],
    },
    {
      id: CLOISTER_IDS.altar,
      kind: "puzzle",
      position: { x: -4.5, z: -5 },
      facing: 0,
      reach: 1.5,
      collider: { x: 0.9, z: 0.9 },
      prompt: "Inspect",
      puzzleId: CLOISTER_IDS.moonPuzzle,
      solvedMessage: { title: "The Moon Altar", message: "The altar glows softly. The moon gate is open." },
    },
  ],

  triggers: [
    {
      id: CLOISTER_IDS.nearSpikes,
      kind: "trap",
      center: { x: 0, z: -3.4 },
      size: { x: INNER_HALF_WIDTH * 2, z: 1.2 },
      timing: SPIKE_TIMING,
      respawnPointId: CLOISTER_IDS.gateCheckpoint,
      hitMessage: "Spikes! Back to the gate.",
    },
    {
      id: CLOISTER_IDS.farSpikes,
      kind: "trap",
      center: { x: 0, z: -6.6 },
      size: { x: INNER_HALF_WIDTH * 2, z: 1.2 },
      timing: SPIKE_TIMING,
      startOffset: 1.4,
      respawnPointId: CLOISTER_IDS.gateCheckpoint,
      hitMessage: "Spikes! Back to the gate.",
    },
    {
      id: CLOISTER_IDS.exit,
      kind: "exit",
      center: { x: 0, z: -8.2 },
      size: { x: 2.5, z: 1.4 },
      requires: { kind: "puzzleSolved", puzzleId: CLOISTER_IDS.moonPuzzle },
      lockedMessage: "The moon gate is sealed. Answer the altar first.",
    },
  ],

  puzzles: [
    {
      id: CLOISTER_IDS.moonPuzzle,
      title: "The Moon Altar",
      question: "Silver moons are carved around the altar's rim. How many should glow?",
      options: ["One", "Two", "Three"],
      correctOptionIndex: 1,
      wrongAnswerHint: "The light fades. The tablet by the east wall may help.",
      solvedNotice: "The moon gate shimmers open!",
    },
  ],

  objectives: [
    {
      id: "find-key",
      text: "Find the silver key",
      completeWhen: { kind: "pickupCollected", pickupId: CLOISTER_IDS.key },
    },
    {
      id: "read-clue",
      text: "Learn how many moons to light",
      completeWhen: {
        kind: "any",
        of: [
          { kind: "inspected", interactableId: CLOISTER_IDS.tablet },
          { kind: "puzzleSolved", puzzleId: CLOISTER_IDS.moonPuzzle },
        ],
      },
    },
    {
      id: "open-gate",
      text: "Unlock the cloister gate",
      completeWhen: { kind: "doorOpened", doorId: CLOISTER_IDS.gate },
    },
    {
      id: "answer-altar",
      text: "Answer the moon altar",
      completeWhen: { kind: "puzzleSolved", puzzleId: CLOISTER_IDS.moonPuzzle },
    },
    {
      id: "escape",
      text: "Reach the moon gate before time runs out",
      completeWhen: { kind: "levelCompleted" },
    },
  ],

  timeLimitSeconds: 120,
  scoring: { parTimeSeconds: 90, starThresholds: [500, 800, 1000] },
  nextLevelId: null,
};
