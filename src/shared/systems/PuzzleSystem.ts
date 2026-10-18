import type { PuzzleDefinition } from "@/types/game";
import type { PlayerId, PuzzleEvent, PuzzleState, PuzzleStatus } from "@/types/state";

import { nextState, type TransitionTable } from "./stateMachine";

/**
 * unsolved --answerCorrect--> solved
 * unsolved --answerWrong--> unsolved (attempt counted)
 * A solved puzzle accepts no further answers.
 */
export const PUZZLE_TRANSITIONS: TransitionTable<PuzzleStatus, PuzzleEvent> = {
  unsolved: { answerCorrect: "solved", answerWrong: "unsolved" },
  solved: {},
};

export const INITIAL_PUZZLE_STATE: PuzzleState = { status: "unsolved", wrongAttempts: 0, solvedBy: null };

/** Look up a puzzle by id. Throws for an unknown id, since that is a level-data bug. */
export function getPuzzle(puzzles: readonly PuzzleDefinition[], id: string): PuzzleDefinition {
  const puzzle = puzzles.find((p) => p.id === id);
  if (!puzzle) throw new Error(`Unknown puzzle "${id}"`);
  return puzzle;
}

export function isCorrectAnswer(puzzle: PuzzleDefinition, optionIndex: number): boolean {
  return optionIndex === puzzle.correctOptionIndex;
}

/** An answer must be one of the puzzle's options; anything else is malformed, not "wrong". */
export function isValidOption(puzzle: PuzzleDefinition, optionIndex: number): boolean {
  return Number.isInteger(optionIndex) && optionIndex >= 0 && optionIndex < puzzle.options.length;
}

export type AnswerOutcome =
  | { kind: "correct"; state: PuzzleState }
  | { kind: "wrong"; state: PuzzleState }
  /** Not applied: the puzzle is already solved, or the option doesn't exist. Nothing is counted. */
  | { kind: "rejected"; reason: "alreadySolved" | "invalidAnswer" };

/** Apply `playerId`'s answer. Pure: returns the new puzzle state. */
export function answerPuzzle(
  puzzle: PuzzleDefinition,
  state: PuzzleState,
  optionIndex: number,
  playerId: PlayerId,
): AnswerOutcome {
  if (!isValidOption(puzzle, optionIndex)) return { kind: "rejected", reason: "invalidAnswer" };

  const correct = isCorrectAnswer(puzzle, optionIndex);
  const status = nextState(PUZZLE_TRANSITIONS, state.status, correct ? "answerCorrect" : "answerWrong");
  if (status === null) return { kind: "rejected", reason: "alreadySolved" };

  return correct
    ? { kind: "correct", state: { ...state, status, solvedBy: playerId } }
    : { kind: "wrong", state: { ...state, status, wrongAttempts: state.wrongAttempts + 1 } };
}
