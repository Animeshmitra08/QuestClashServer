/**
 * A state machine written as a lookup table: for each state, which events are
 * allowed and which state each one leads to. Anything not in the table is an
 * invalid transition, so impossible situations (resuming a finished level,
 * re-solving a solved puzzle) can't happen by accident.
 */
export type TransitionTable<S extends string, E extends string> = {
  readonly [State in S]: Readonly<Partial<Record<E, S>>>;
};

/** The state after `event`, or null if `event` isn't allowed in `state`. */
export function nextState<S extends string, E extends string>(
  table: TransitionTable<S, E>,
  state: S,
  event: E,
): S | null {
  return table[state][event] ?? null;
}
