import type { JoystickVector, PlayerState, Vec2 } from "@/types/game";

import type { Collider } from "./CollisionSystem";

/** The player's collision radius on the floor plane. The placeholder body matches it. */
export const PLAYER_RADIUS = 0.4;
/** Top walking speed, in world units (≈ metres) per second. */
export const MAX_SPEED = 4.5;
/** Stick deflection below this is ignored, so a resting thumb doesn't cause drift. */
const DEAD_ZONE = 0.15;
/** How fast velocity reaches the target. Higher feels snappier; lower feels heavier. */
const ACCELERATION_SHARPNESS = 14;
/** How fast the character turns to face where it is moving. */
const TURN_SHARPNESS = 12;
/** Below this stick deflection the character keeps its current facing instead of turning. */
const MIN_TURN_INPUT = 0.05;
/** Clamp long frames (app resume, debugger pause) so the player never teleports. */
const MAX_FRAME_DELTA = 0.1;

/** Fraction of the remaining distance to cover this frame, independent of frame rate. */
function smoothingFactor(sharpness: number, dt: number) {
  return 1 - Math.exp(-sharpness * dt);
}

/** Move angle `current` toward `target` along the shortest way around the circle. */
function dampAngle(current: number, target: number, sharpness: number, dt: number) {
  let delta = (target - current) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * smoothingFactor(sharpness, dt);
}

/** Rescale stick input so the dead zone is ignored and the rest still spans 0..1. */
function applyDeadZone(stick: JoystickVector, out: JoystickVector): JoystickVector {
  const length = Math.hypot(stick.x, stick.y);
  if (length < DEAD_ZONE) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  const scaled = Math.min((length - DEAD_ZONE) / (1 - DEAD_ZONE), 1);
  out.x = (stick.x / length) * scaled;
  out.y = (stick.y / length) * scaled;
  return out;
}

const filteredStick: JoystickVector = { x: 0, y: 0 };

/**
 * Turns joystick input into player movement. Pure game logic: it knows nothing
 * about Three.js meshes, React, or touch events.
 *
 * Movement is camera-relative: pushing the stick up always moves the character
 * "into the screen", whichever way the camera faces.
 */
export class MovementController {
  readonly state: PlayerState;
  private readonly collider: Collider | null;

  constructor(spawn: Vec2, facing: number, collider: Collider | null = null) {
    this.collider = collider;
    this.state = {
      position: { x: spawn.x, z: spawn.z },
      velocity: { x: 0, z: 0 },
      facing,
      moveAmount: 0,
      lastInteractTime: -Infinity,
      time: 0,
    };
  }

  /**
   * Advance one frame.
   * @param stick Joystick deflection.
   * @param cameraForward Unit vector on the floor plane pointing where the camera looks.
   * @param rawDelta Seconds since the last frame.
   */
  update(stick: JoystickVector, cameraForward: Vec2, rawDelta: number) {
    const dt = Math.min(rawDelta, MAX_FRAME_DELTA);
    const { state } = this;
    state.time += dt;

    const input = applyDeadZone(stick, filteredStick);

    // Camera "right" is camera "forward" turned 90° clockwise when seen from above.
    const rightX = -cameraForward.z;
    const rightZ = cameraForward.x;
    const targetVelocityX = (rightX * input.x + cameraForward.x * input.y) * MAX_SPEED;
    const targetVelocityZ = (rightZ * input.x + cameraForward.z * input.y) * MAX_SPEED;

    // Ease toward the target velocity instead of jumping to it: responsive but not jerky.
    const accel = smoothingFactor(ACCELERATION_SHARPNESS, dt);
    state.velocity.x += (targetVelocityX - state.velocity.x) * accel;
    state.velocity.z += (targetVelocityZ - state.velocity.z) * accel;

    state.position.x += state.velocity.x * dt;
    state.position.z += state.velocity.z * dt;

    // Undo any overlap with walls/obstacles; also trims velocity so the player slides.
    this.collider?.resolve(state.position, state.velocity, PLAYER_RADIUS);

    // Measured after collision, so walking into a wall stops the walk animation.
    const speed = Math.hypot(state.velocity.x, state.velocity.z);
    state.moveAmount = Math.min(speed / MAX_SPEED, 1);

    // Face where the stick points (not where we ended up moving), so pushing
    // against a wall still turns the character toward it.
    if (Math.hypot(targetVelocityX, targetVelocityZ) > MIN_TURN_INPUT * MAX_SPEED) {
      // The model faces +z at angle 0, so the heading of (x, z) is atan2(x, z).
      const targetFacing = Math.atan2(targetVelocityX, targetVelocityZ);
      state.facing = dampAngle(state.facing, targetFacing, TURN_SHARPNESS, dt);
    }
  }

  /** Record an interaction press (drives the feedback ring and, later, cooldowns). */
  interact() {
    this.state.lastInteractTime = this.state.time;
  }

  /** Put the player back at a spawn point, standing still. */
  reset(spawn: Vec2, facing: number) {
    const { state } = this;
    state.position.x = spawn.x;
    state.position.z = spawn.z;
    state.velocity.x = 0;
    state.velocity.z = 0;
    state.facing = facing;
    state.moveAmount = 0;
    state.lastInteractTime = -Infinity;
  }
}
