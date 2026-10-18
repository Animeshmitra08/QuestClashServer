import type { LevelDefinition, ScoringRules } from "@/types/game";
import type { MatchState, PlayerId } from "@/types/state";

import { countOpenDoors, countSolvedPuzzles, countTrapHits, countWrongAnswers, distinctCluesRead } from "./gameState";

/** Scoring used by every level unless its config overrides a value. */
export const DEFAULT_SCORING: ScoringRules = {
  itemFound: 100,
  clueRead: 50,
  puzzleSolved: 200,
  doorOpened: 100,
  exitReached: 500,
  perTrapHit: -50,
  perWrongAnswer: -25,
  parTimeSeconds: 180,
  timeBonusPerSecond: 5,
  starThresholds: [700, 1100, 1400],
};

/** The level's scoring: its overrides on top of the defaults. */
export function resolveScoring(level: LevelDefinition): ScoringRules {
  return { ...DEFAULT_SCORING, ...level.scoring };
}

export interface ScoreLine {
  label: string;
  points: number;
}

export interface ScoreBreakdown {
  lines: ScoreLine[];
  total: number;
  /** 0–3, from the level's star thresholds. Only meaningful once completed. */
  stars: number;
}

/**
 * Floor to whole seconds, tolerating floating-point drift: adding 1/60 sixty
 * times gives 0.99999…, which should still count as 1 second.
 */
export function wholeSeconds(seconds: number) {
  return Math.floor(seconds + 1e-6);
}

export function starsFor(total: number, rules: ScoringRules): number {
  return rules.starThresholds.filter((threshold) => total >= threshold).length;
}

/**
 * Team score: the shared result that decides stars. Calculated from progress
 * instead of being stored, so it can never disagree with what happened.
 *
 * Each shared milestone counts once, however many players were involved (one key
 * found = one "item found"). Penalties are summed over all players. A clue counts
 * once it has been read by anyone. The exit points and time bonus only count once
 * the level is completed. With one player this is exactly that player's result.
 */
export function calculateScore(state: MatchState, rules: ScoringRules = DEFAULT_SCORING): ScoreBreakdown {
  const lines: ScoreLine[] = [];
  const add = (label: string, points: number) => {
    if (points !== 0) lines.push({ label, points });
  };

  const wrongAnswers = countWrongAnswers(state);
  const trapHits = countTrapHits(state);
  add("Items found", Object.keys(state.world.collectedPickups).length * rules.itemFound);
  add("Clues read", distinctCluesRead(state) * rules.clueRead);
  add("Puzzles solved", countSolvedPuzzles(state) * rules.puzzleSolved);
  add("Doors opened", countOpenDoors(state) * rules.doorOpened);
  add(`Trap hits ×${trapHits}`, trapHits * rules.perTrapHit);
  add(`Wrong answers ×${wrongAnswers}`, wrongAnswers * rules.perWrongAnswer);

  if (state.status === "completed") {
    add("Level complete", rules.exitReached);
    add("Time bonus", timeBonus(state, rules));
  }

  const total = sumLines(lines);
  return { lines, total, stars: state.status === "completed" ? starsFor(total, rules) : 0 };
}

/**
 * Personal score: what one player contributed. Milestones are credited to the
 * player responsible (the collector, the solver, the opener; every reader of a
 * clue, since clues are personal). Penalties are their own. The exit points and
 * time bonus go to every player who escaped. Personal scores are for a results
 * screen; they don't add up to the team score, which counts milestones once.
 */
export function calculatePlayerScore(
  state: MatchState,
  playerId: PlayerId,
  rules: ScoringRules = DEFAULT_SCORING,
): ScoreBreakdown {
  const player = state.players[playerId];
  if (!player) return { lines: [], total: 0, stars: 0 };
  const { world } = state;
  const lines: ScoreLine[] = [];
  const add = (label: string, points: number) => {
    if (points !== 0) lines.push({ label, points });
  };

  const count = (owners: readonly (PlayerId | null)[]) => owners.filter((owner) => owner === playerId).length;
  add("Items found", count(Object.values(world.collectedPickups)) * rules.itemFound);
  add("Clues read", player.inspectedIds.length * rules.clueRead);
  add("Puzzles solved", count(Object.values(world.puzzles).map((p) => p.solvedBy)) * rules.puzzleSolved);
  add("Doors opened", count(Object.values(world.doors).map((d) => d.openedBy)) * rules.doorOpened);
  add(`Trap hits ×${player.trapHits}`, player.trapHits * rules.perTrapHit);
  add(`Wrong answers ×${player.wrongAnswers}`, player.wrongAnswers * rules.perWrongAnswer);

  if (player.status === "escaped") {
    add("Escaped", rules.exitReached);
    add("Time bonus", timeBonus(state, rules));
  }

  return { lines, total: sumLines(lines), stars: 0 };
}

function timeBonus(state: MatchState, rules: ScoringRules) {
  return Math.max(0, rules.parTimeSeconds - wholeSeconds(state.elapsedSeconds)) * rules.timeBonusPerSecond;
}

/** Never show a negative score; that just feels bad. */
function sumLines(lines: ScoreLine[]) {
  return Math.max(0, lines.reduce((total, line) => total + line.points, 0));
}

/** 83.4 → "1:23" */
export function formatTime(seconds: number): string {
  const whole = Math.max(0, wholeSeconds(seconds));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}
