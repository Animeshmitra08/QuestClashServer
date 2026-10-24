import type { LevelBlock } from "@/types/game";

/**
 * Small helpers for writing level layouts. They only produce plain data
 * (LevelBlock objects); they contain no gameplay logic.
 */

export const WALL_THICKNESS = 1;

interface RoomOptions {
  /** Distance from the center to the outer face of the side walls (x). */
  halfWidth: number;
  /** Distance from the center to the outer face of the north/south walls (z). */
  halfDepth: number;
  height?: number;
  /** The south wall faces the camera, so it is kept low to never hide the player. */
  southHeight?: number;
}

/** The four outer walls of a rectangular room: ids wall-north, wall-south, wall-west, wall-east. */
export function outerWalls({ halfWidth, halfDepth, height = 3, southHeight = 0.8 }: RoomOptions): LevelBlock[] {
  const t = WALL_THICKNESS;
  return [
    { id: "wall-north", kind: "wall", center: { x: 0, z: -halfDepth + t / 2 }, size: { x: halfWidth * 2, z: t }, height },
    { id: "wall-south", kind: "wall", center: { x: 0, z: halfDepth - t / 2 }, size: { x: halfWidth * 2, z: t }, height: southHeight },
    { id: "wall-west", kind: "wall", center: { x: -halfWidth + t / 2, z: 0 }, size: { x: t, z: halfDepth * 2 }, height },
    { id: "wall-east", kind: "wall", center: { x: halfWidth - t / 2, z: 0 }, size: { x: t, z: halfDepth * 2 }, height },
  ];
}

interface GapWallOptions {
  /** Base id; the two pieces become `${id}-west` and `${id}-east`. */
  id: string;
  /** Where the wall runs across the room. */
  z: number;
  /** Half the room's inside width (outer half-width minus the wall thickness). */
  innerHalfWidth: number;
  /** Half the width of the opening in the middle (where a door usually goes). */
  gapHalfWidth: number;
  height: number;
}

/** A wall across the room with an opening in the middle (centered on x = 0). */
export function wallWithGap({ id, z, innerHalfWidth, gapHalfWidth, height }: GapWallOptions): LevelBlock[] {
  const pieceWidth = innerHalfWidth - gapHalfWidth;
  const pieceCenterX = gapHalfWidth + pieceWidth / 2;
  const piece = (suffix: string, x: number): LevelBlock => ({
    id: `${id}-${suffix}`,
    kind: "wall",
    center: { x, z },
    size: { x: pieceWidth, z: WALL_THICKNESS },
    height,
  });
  return [piece("west", -pieceCenterX), piece("east", pieceCenterX)];
}

export function pillar(id: string, x: number, z: number, size = 1.2, height = 3): LevelBlock {
  return { id, kind: "pillar", center: { x, z }, size: { x: size, z: size }, height };
}

export function crate(id: string, x: number, z: number, size = 1): LevelBlock {
  return { id, kind: "crate", center: { x, z }, size: { x: size, z: size }, height: size };
}

// --- Nature -----------------------------------------------------------------------------

/** A round, leafy tree. You bump into the trunk (0.8 × 0.8); the crown spreads overhead. */
export function tree(id: string, x: number, z: number, height = 4.5): LevelBlock {
  return { id, kind: "tree", center: { x, z }, size: { x: 0.8, z: 0.8 }, height };
}

/** A tall pine. You bump into the trunk (0.7 × 0.7). */
export function pine(id: string, x: number, z: number, height = 5.5): LevelBlock {
  return { id, kind: "pine", center: { x, z }, size: { x: 0.7, z: 0.7 }, height };
}

export function rock(id: string, x: number, z: number, width = 1.4, depth = width, height = Math.max(width, depth) * 0.7): LevelBlock {
  return { id, kind: "rock", center: { x, z }, size: { x: width, z: depth }, height };
}

export function bush(id: string, x: number, z: number, size = 1.3): LevelBlock {
  return { id, kind: "bush", center: { x, z }, size: { x: size, z: size }, height: size * 0.75 };
}

/** A fallen trunk lying along x or z. */
export function log(id: string, x: number, z: number, length = 3, along: "x" | "z" = "x", thickness = 0.6): LevelBlock {
  const size = along === "x" ? { x: length, z: thickness } : { x: thickness, z: length };
  return { id, kind: "log", center: { x, z }, size, height: thickness };
}

export function stump(id: string, x: number, z: number, size = 0.8): LevelBlock {
  return { id, kind: "stump", center: { x, z }, size: { x: size, z: size }, height: 0.5 };
}

/** A dense band of trees filling the rectangle from (minX, minZ) to (maxX, maxZ): nobody gets through. */
export function treeLine(id: string, minX: number, minZ: number, maxX: number, maxZ: number, height = 5): LevelBlock {
  return {
    id,
    kind: "treeline",
    center: { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 },
    size: { x: maxX - minX, z: maxZ - minZ },
    height,
  };
}

interface ForestEdgeOptions {
  /** Distance from the center to the outside edge of the forest (x), usually half the floor width. */
  halfWidth: number;
  /** Distance from the center to the outside edge of the forest (z), usually half the floor depth. */
  halfDepth: number;
  /** How deep the band of trees is. The playable area ends this far inside the edge. */
  depth?: number;
  height?: number;
}

/**
 * The edge of an open map: four bands of trees, ids forest-north, forest-south,
 * forest-west, forest-east. The south band (nearest the camera) is a little lower;
 * trees between the camera and the player fade out anyway.
 */
export function forestEdge({ halfWidth, halfDepth, depth = 4, height = 5 }: ForestEdgeOptions): LevelBlock[] {
  const innerX = halfWidth - depth;
  return [
    treeLine("forest-north", -halfWidth, -halfDepth, halfWidth, -halfDepth + depth, height),
    treeLine("forest-south", -halfWidth, halfDepth - depth, halfWidth, halfDepth, height * 0.8),
    treeLine("forest-west", -halfWidth, -halfDepth + depth, -innerX, halfDepth - depth, height),
    treeLine("forest-east", innerX, -halfDepth + depth, halfWidth, halfDepth - depth, height),
  ];
}
