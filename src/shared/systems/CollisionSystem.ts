import type { CollisionBox, LevelDefinition, Rect, Vec2 } from "@/types/game";

/** Anything that can push a moving circle out of solid geometry. */
export interface Collider {
  resolve(position: Vec2, velocity: Vec2, radius: number): void;
}

/**
 * Pushing out of one box can push the player into another (e.g. in a corner),
 * so resolve a few times. Three passes is plenty for this level's geometry.
 */
const MAX_PASSES = 3;
const EPSILON = 1e-9;

/**
 * Keeps the player (a circle on the floor plane) out of solid boxes.
 *
 * This is "push-out" collision, not a physics engine: after the player moves,
 * any overlap with a box is undone along the shortest direction, and the part of
 * the velocity pointing into the box is removed. Removing only that part is what
 * makes the player slide along walls instead of stopping dead.
 *
 * At max speed the player moves ≤ 0.45 units per frame, well under the thinnest
 * wall (1 unit), so fast movement can't tunnel through geometry.
 */
export class CollisionSystem implements Collider {
  private readonly boxes: CollisionBox[];
  private readonly disabled = new Set<string>();

  constructor(boxes: CollisionBox[]) {
    this.boxes = boxes;
  }

  /** Turn a box's collision off or on, e.g. when a door opens. */
  setEnabled(id: string, enabled: boolean) {
    if (enabled) this.disabled.delete(id);
    else this.disabled.add(id);
  }

  resolve(position: Vec2, velocity: Vec2, radius: number) {
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      let hitAnything = false;
      for (const box of this.boxes) {
        if (this.disabled.has(box.id)) continue;
        if (pushOutOfBox(position, velocity, radius, box)) hitAnything = true;
      }
      if (!hitAnything) return;
    }
  }
}

/** Resolve one circle-vs-box overlap. Returns true if there was one. */
function pushOutOfBox(position: Vec2, velocity: Vec2, radius: number, box: CollisionBox) {
  const minX = box.center.x - box.size.x / 2;
  const maxX = box.center.x + box.size.x / 2;
  const minZ = box.center.z - box.size.z / 2;
  const maxZ = box.center.z + box.size.z / 2;

  // Closest point on the box to the circle's center.
  const closestX = Math.max(minX, Math.min(position.x, maxX));
  const closestZ = Math.max(minZ, Math.min(position.z, maxZ));
  const dx = position.x - closestX;
  const dz = position.z - closestZ;
  const distanceSq = dx * dx + dz * dz;

  if (distanceSq >= radius * radius) return false;

  let normalX: number;
  let normalZ: number;
  let depth: number;

  if (distanceSq > EPSILON) {
    // Center is outside the box: push straight away from the closest point.
    const distance = Math.sqrt(distanceSq);
    normalX = dx / distance;
    normalZ = dz / distance;
    depth = radius - distance;
  } else {
    // Center is inside the box: leave through the nearest side.
    const toLeft = position.x - minX;
    const toRight = maxX - position.x;
    const toFront = position.z - minZ;
    const toBack = maxZ - position.z;
    const nearest = Math.min(toLeft, toRight, toFront, toBack);
    normalX = nearest === toLeft ? -1 : nearest === toRight ? 1 : 0;
    normalZ = normalX !== 0 ? 0 : nearest === toFront ? -1 : 1;
    depth = nearest + radius;
  }

  position.x += normalX * depth;
  position.z += normalZ * depth;

  // Cancel only the velocity component pointing into the box, keep the sliding part.
  const intoBox = velocity.x * normalX + velocity.z * normalZ;
  if (intoBox < 0) {
    velocity.x -= intoBox * normalX;
    velocity.z -= intoBox * normalZ;
  }
  return true;
}

/** True if a circle on the floor overlaps a rectangle (used for trigger zones). */
export function circleOverlapsRect(position: Vec2, radius: number, rect: Rect) {
  const halfX = rect.size.x / 2;
  const halfZ = rect.size.z / 2;
  const dx = Math.max(Math.abs(position.x - rect.center.x) - halfX, 0);
  const dz = Math.max(Math.abs(position.z - rect.center.z) - halfZ, 0);
  return dx * dx + dz * dz < radius * radius;
}

/** Collision for a level: every block, plus the footprint of each solid interactable. */
export function createLevelCollision(level: LevelDefinition) {
  const interactableBoxes: CollisionBox[] = level.interactables.flatMap((item) =>
    item.collider ? [{ id: item.id, center: item.position, size: item.collider }] : [],
  );
  return new CollisionSystem([...level.blocks, ...interactableBoxes]);
}
