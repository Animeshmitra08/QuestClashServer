import type { Collider } from "@/systems/CollisionSystem";
import { MAX_SPEED, PLAYER_RADIUS } from "@/systems/MovementController";
import type { Vec2 } from "@/types/game";

/** Allow for network jitter: reports can bunch up, so permit a bit more than walking speed. */
const SPEED_ALLOWANCE = 1.35;
/** Extra distance always allowed per report (rounding, collision push-outs). */
const STEP_SLACK = 0.25;
/** Never trust a gap longer than this when working out how far the player could walk. */
const MAX_GAP_SECONDS = 1;

/**
 * Checks the positions one client reports for its player before the server uses
 * them for traps, exits and reach. A report further than the player could have
 * walked is clamped to the furthest legal point in that direction; a position
 * inside a wall is pushed out. So a modified client can't teleport to the exit
 * or walk through the closed door.
 */
export class MovementGuard {
  private position: Vec2;
  private lastReportAt: number;

  constructor(
    start: Vec2,
    private readonly collider: Collider,
    now: number,
  ) {
    this.position = { ...start };
    this.lastReportAt = now;
  }

  get current(): Vec2 {
    return this.position;
  }

  /** Put the player somewhere directly (spawn, respawn). */
  reset(position: Vec2, now: number) {
    this.position = { ...position };
    this.lastReportAt = now;
  }

  /** Accept a reported position, corrected if needed. `now` in milliseconds. Returns the accepted position. */
  accept(reported: Vec2, now: number): { position: Vec2; corrected: boolean } {
    if (!Number.isFinite(reported.x) || !Number.isFinite(reported.z)) {
      return { position: this.position, corrected: true };
    }

    const elapsed = Math.min(Math.max(now - this.lastReportAt, 0) / 1000, MAX_GAP_SECONDS);
    this.lastReportAt = now;
    const maxStep = MAX_SPEED * SPEED_ALLOWANCE * elapsed + STEP_SLACK;

    const dx = reported.x - this.position.x;
    const dz = reported.z - this.position.z;
    const distance = Math.hypot(dx, dz);
    let corrected = false;
    const next = { ...reported };
    if (distance > maxStep) {
      next.x = this.position.x + (dx / distance) * maxStep;
      next.z = this.position.z + (dz / distance) * maxStep;
      corrected = true;
    }

    const beforeCollision = { ...next };
    this.collider.resolve(next, { x: 0, z: 0 }, PLAYER_RADIUS);
    if (next.x !== beforeCollision.x || next.z !== beforeCollision.z) corrected = true;

    this.position = next;
    return { position: next, corrected };
  }
}
