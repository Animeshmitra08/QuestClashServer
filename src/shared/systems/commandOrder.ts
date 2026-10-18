import type { GameCommand } from "@/types/commands";

/**
 * The order commands resolved together are applied in. Deterministic, so every
 * peer (or a future authoritative host) resolving the same batch gets the same
 * result:
 *   1. earlier tick first
 *   2. then lower sequence number (arrival order at the host)
 *   3. then player id, alphabetically, as a last tie-break
 * The first valid command wins; a later command that conflicts with it (the key
 * is gone, the door is open, the puzzle is solved) is rejected, not partly applied.
 */
export function orderCommands(commands: readonly GameCommand[]): GameCommand[] {
  return commands
    .map((command, index) => ({ command, index }))
    .sort(
      (a, b) =>
        (a.command.tick ?? 0) - (b.command.tick ?? 0) ||
        (a.command.sequence ?? Number.MAX_SAFE_INTEGER) - (b.command.sequence ?? Number.MAX_SAFE_INTEGER) ||
        (a.command.playerId < b.command.playerId ? -1 : a.command.playerId > b.command.playerId ? 1 : 0) ||
        a.index - b.index,
    )
    .map(({ command }) => command);
}
