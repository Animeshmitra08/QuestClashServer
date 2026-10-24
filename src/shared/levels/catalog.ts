import type { LevelDefinition } from "@/types/game";

import cloisterJson from "./cloister.json";
import { templeLevel } from "./temple";

/**
 * A level written as JSON. TypeScript reads `"kind": "wall"` in a JSON file as a
 * plain string, so the file can't be type-checked as a LevelDefinition here; the
 * level loader validates it before it's played instead (and the editor checks it
 * against level.schema.json while you write it).
 */
const jsonLevel = (data: unknown) => data as LevelDefinition;

/**
 * All playable levels, in play order. To add a level: write its definition in its
 * own file (TypeScript, or JSON like cloister.json), add it here, and point the
 * previous level's `nextLevelId` at it. See docs/LEVELS.md.
 *
 * Level definitions are small plain data, so keeping them all in memory is
 * cheap. Their art is what's heavy, and that is only loaded for the level being
 * played (see assets.ts).
 */
export const LEVEL_CATALOG: readonly LevelDefinition[] = [templeLevel, jsonLevel(cloisterJson)];

export const FIRST_LEVEL_ID = LEVEL_CATALOG[0].id;
