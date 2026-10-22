import { type ClientCommand, type ClientMessages, MAX_REPORTED_PING_MS } from "@/net/protocol";

/**
 * Clients can send anything, so every message is checked here before the room
 * looks at it. Anything malformed comes back as null and is ignored or refused.
 */

const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 64;
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function parseMove(raw: unknown): ClientMessages["move"] | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (!isNumber(m.x) || !isNumber(m.z) || !isNumber(m.facing) || !isNumber(m.moveAmount) || !isNumber(m.respawnSeq)) {
    return null;
  }
  return { x: m.x, z: m.z, facing: m.facing, moveAmount: m.moveAmount, respawnSeq: m.respawnSeq };
}

/** A reported ping as a whole number of ms (at least 1, so 0 keeps meaning "not measured"). */
export function parsePing(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const ms = (raw as Record<string, unknown>).ms;
  if (!isNumber(ms) || ms < 0) return null;
  return Math.min(Math.max(Math.round(ms), 1), MAX_REPORTED_PING_MS);
}

export function parseClientCommand(raw: unknown): ClientCommand | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  switch (c.type) {
    case "interact":
      return isText(c.targetId) ? { type: "interact", targetId: c.targetId } : null;
    case "collectItem":
      return isText(c.pickupId) ? { type: "collectItem", pickupId: c.pickupId } : null;
    case "activateObject":
      return isText(c.objectId) ? { type: "activateObject", objectId: c.objectId } : null;
    case "completeObjective":
      return isText(c.objectiveId) ? { type: "completeObjective", objectiveId: c.objectiveId } : null;
    case "submitPuzzleAnswer":
      // The option index is checked by the rules (out of range → "invalidAnswer").
      return isText(c.puzzleId) && typeof c.optionIndex === "number"
        ? { type: "submitPuzzleAnswer", puzzleId: c.puzzleId, optionIndex: c.optionIndex }
        : null;
    default:
      return null;
  }
}
