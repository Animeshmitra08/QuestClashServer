import type { LevelDefinition, ObjectiveCondition } from "@/types/game";

const REQUIRED_LISTS = [
  "blocks",
  "interactables",
  "triggers",
  "puzzles",
  "objectives",
  "spawnPoints",
] as const satisfies readonly (keyof LevelDefinition)[];

/**
 * The basic shape, checked first, so a malformed config (for example hand-written
 * JSON) produces a clear message instead of a crash deeper in validation.
 */
function checkShape(level: LevelDefinition): string[] {
  const problems: string[] = [];
  const raw = level as unknown as Record<string, unknown>;
  if (!raw || typeof raw !== "object") return ["level config is not an object"];
  for (const field of ["id", "name", "playerSpawnId"] as const) {
    if (typeof raw[field] !== "string" || raw[field] === "") problems.push(`"${field}" must be a non-empty string`);
  }
  for (const field of REQUIRED_LISTS) {
    if (!Array.isArray(raw[field])) problems.push(`"${field}" must be a list`);
  }
  if (!raw.theme || typeof raw.theme !== "object") problems.push(`"theme" is missing`);
  const floor = raw.floorSize as { x?: unknown; z?: unknown } | undefined;
  if (!floor || typeof floor.x !== "number" || typeof floor.z !== "number" || floor.x <= 0 || floor.z <= 0) {
    problems.push(`"floorSize" must have positive x and z`);
  }
  return problems;
}

/**
 * Checks a level for data mistakes: missing fields, duplicate ids, references to
 * things that don't exist, and out-of-range numbers. Returns a list of problems
 * (empty = valid). Cross-level references (nextLevelId) and assets are checked by
 * the level loader, which knows the catalog and the asset registry.
 *
 * Blocks, interactables and triggers share one id namespace because collision
 * toggles boxes by id (an opened door switches off the box with the door's id).
 */
export function validateLevel(level: LevelDefinition): string[] {
  const shapeProblems = checkShape(level);
  if (shapeProblems.length > 0) return shapeProblems;

  const problems: string[] = [];

  const checkUnique = (namespace: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (!id) problems.push(`${namespace}: empty id`);
      else if (seen.has(id)) problems.push(`${namespace}: duplicate id "${id}"`);
      seen.add(id);
    }
  };

  checkUnique("world objects", [
    ...level.blocks.map((b) => b.id),
    ...level.interactables.map((i) => i.id),
    ...level.triggers.map((t) => t.id),
  ]);
  checkUnique("puzzles", level.puzzles.map((p) => p.id));
  checkUnique("objectives", level.objectives.map((o) => o.id));
  checkUnique("spawn points", level.spawnPoints.map((s) => s.id));

  const pickupItems = level.interactables.flatMap((i) => (i.kind === "pickup" ? [i.item] : []));
  checkUnique("items", pickupItems.map((item) => item.id));

  const interactableIds = new Set(level.interactables.map((i) => i.id));
  const pickupIds = new Set(level.interactables.filter((i) => i.kind === "pickup").map((i) => i.id));
  const doorIds = new Set(level.interactables.filter((i) => i.kind === "door").map((i) => i.id));
  const puzzleIds = new Set(level.puzzles.map((p) => p.id));
  const itemIds = new Set(pickupItems.map((item) => item.id));
  const spawnIds = new Set(level.spawnPoints.map((s) => s.id));

  if (!spawnIds.has(level.playerSpawnId)) {
    problems.push(`player spawn point "${level.playerSpawnId}" does not exist`);
  }

  for (const item of level.interactables) {
    if (item.reach <= 0) problems.push(`"${item.id}": reach must be positive`);
    if (item.kind === "door") {
      for (const requirement of item.requirements) {
        if (requirement.kind === "item" && !itemIds.has(requirement.itemId)) {
          problems.push(`door "${item.id}": required item "${requirement.itemId}" is not a pickup in this level`);
        }
        if (requirement.kind === "puzzle" && !puzzleIds.has(requirement.puzzleId)) {
          problems.push(`door "${item.id}": required puzzle "${requirement.puzzleId}" does not exist`);
        }
      }
      if (!item.collider) problems.push(`door "${item.id}": needs a collider to block the way`);
    }
    if (item.kind === "puzzle" && !puzzleIds.has(item.puzzleId)) {
      problems.push(`puzzle object "${item.id}": puzzle "${item.puzzleId}" does not exist`);
    }
  }

  for (const puzzle of level.puzzles) {
    if (puzzle.correctOptionIndex < 0 || puzzle.correctOptionIndex >= puzzle.options.length) {
      problems.push(`puzzle "${puzzle.id}": correctOptionIndex is out of range`);
    }
  }

  const checkCondition = (owner: string, condition: ObjectiveCondition) => {
    const missing = (what: string, id: string) => problems.push(`${owner}: ${what} "${id}" does not exist`);
    switch (condition.kind) {
      case "pickupCollected":
        if (!pickupIds.has(condition.pickupId)) missing("pickup", condition.pickupId);
        break;
      case "inspected":
        if (!interactableIds.has(condition.interactableId)) missing("object", condition.interactableId);
        break;
      case "puzzleSolved":
        if (!puzzleIds.has(condition.puzzleId)) missing("puzzle", condition.puzzleId);
        break;
      case "doorOpened":
        if (!doorIds.has(condition.doorId)) missing("door", condition.doorId);
        break;
      case "levelCompleted":
        break;
      case "any":
        condition.of.forEach((inner) => checkCondition(owner, inner));
        break;
    }
  };

  for (const trigger of level.triggers) {
    if (trigger.kind === "trap") {
      if (Object.values(trigger.timing).some((seconds) => !(seconds > 0))) {
        problems.push(`trap "${trigger.id}": every phase duration must be positive`);
      }
      if (!spawnIds.has(trigger.respawnPointId)) {
        problems.push(`trap "${trigger.id}": respawn point "${trigger.respawnPointId}" does not exist`);
      }
    }
    if (trigger.kind === "exit" && trigger.requires) {
      if (trigger.requires.kind === "levelCompleted") {
        problems.push(`exit "${trigger.id}": can't require the level to be completed`);
      } else {
        checkCondition(`exit "${trigger.id}"`, trigger.requires);
      }
    }
  }
  if (!level.triggers.some((t) => t.kind === "exit")) problems.push("level has no exit");

  level.objectives.forEach((objective) => checkCondition(`objective "${objective.id}"`, objective.completeWhen));

  if (level.timeLimitSeconds !== undefined && !(level.timeLimitSeconds > 0)) {
    problems.push("timeLimitSeconds must be positive");
  }
  const stars = level.scoring?.starThresholds;
  if (stars && !(stars[0] <= stars[1] && stars[1] <= stars[2])) {
    problems.push("scoring.starThresholds must be in increasing order");
  }

  return problems;
}
