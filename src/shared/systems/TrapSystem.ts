import type { TrapPhase, TrapTiming } from "@/types/game";
import type { TrapState } from "@/types/state";

/** Spike offset from the floor while hidden: far enough down to be out of sight. */
export const HIDDEN_HEIGHT = -0.7;
const WARNING_HEIGHT = -0.45;
/** Spikes hurt only while above this height (late in rising, armed, early in retracting). */
const LETHAL_HEIGHT = -0.25;

const PHASE_ORDER: readonly TrapPhase[] = ["hidden", "warning", "rising", "armed", "retracting"];

function lerp(from: number, to: number, t: number) {
  return from + (to - from) * t;
}

export function cycleLength(timing: TrapTiming) {
  return PHASE_ORDER.reduce((total, phase) => total + timing[phase], 0);
}

/** Which phase a point in the cycle falls in, and how far through that phase (0..1). */
export function phaseAt(timing: TrapTiming, cycleTime: number): { phase: TrapPhase; progress: number } {
  let start = 0;
  for (const phase of PHASE_ORDER) {
    const duration = timing[phase];
    if (cycleTime < start + duration) {
      return { phase, progress: (cycleTime - start) / duration };
    }
    start += duration;
  }
  return { phase: "hidden", progress: 0 };
}

function heightFor(phase: TrapPhase, progress: number): number {
  switch (phase) {
    case "hidden":
      return HIDDEN_HEIGHT;
    case "warning":
      return WARNING_HEIGHT;
    case "rising":
      return lerp(WARNING_HEIGHT, 0, progress);
    case "armed":
      return 0;
    case "retracting":
      return lerp(0, HIDDEN_HEIGHT, progress);
  }
}

/**
 * One timed spike trap. StageManager advances it every frame and the renderer
 * reads it every frame. Mutable on purpose: it changes 60 times a second and
 * must not go through React.
 */
export class TrapSystem implements TrapState {
  private time: number;
  phase: TrapPhase = "hidden";
  height = HIDDEN_HEIGHT;
  lethal = false;

  constructor(
    private readonly timing: TrapTiming,
    private readonly startOffset = 0,
  ) {
    this.time = startOffset % cycleLength(timing);
    this.apply();
  }

  update(dt: number) {
    this.time = (this.time + dt) % cycleLength(this.timing);
    this.apply();
  }

  /**
   * Jump to where the trap is `matchSeconds` into the match. An online client uses
   * this to keep its copy of a trap (for drawing) in step with the server's clock.
   */
  setMatchTime(matchSeconds: number) {
    this.time = (this.startOffset + matchSeconds) % cycleLength(this.timing);
    this.apply();
  }

  private apply() {
    const { phase, progress } = phaseAt(this.timing, this.time);
    this.phase = phase;
    this.height = heightFor(phase, progress);
    const spikesOut = phase === "rising" || phase === "armed" || phase === "retracting";
    this.lethal = spikesOut && this.height > LETHAL_HEIGHT;
  }
}
