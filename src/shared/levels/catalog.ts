import type { LevelDefinition } from "@/types/game";

import { cloisterLevel } from "./cloister";
import { templeLevel } from "./temple";

/**
 * All playable levels, in play order. To add a level: write its definition in
 * its own file, add it here, and point the previous level's `nextLevelId` at it.
 *
 * Level definitions are small plain data, so keeping them all in memory is
 * cheap. Their art is what's heavy, and that is only loaded for the level being
 * played (see assets.ts).
 */
export const LEVEL_CATALOG: readonly LevelDefinition[] = [templeLevel, cloisterLevel];

export const FIRST_LEVEL_ID = LEVEL_CATALOG[0].id;
