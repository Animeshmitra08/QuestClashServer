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

/** A wall across the room with an opening in the middle. */
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
