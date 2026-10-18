import type { Presence } from "@colyseus/core";

import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "@/net/protocol";

/** Presence set holding every room code in use (shared across processes with Redis presence). */
const CODES_KEY = "questclash:room-codes";

function randomCode(): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET.charAt(Math.floor(Math.random() * ROOM_CODE_ALPHABET.length));
  }
  return code;
}

/**
 * A short, unused room code (the Colyseus "custom room id" recipe). 31^5 ≈ 28
 * million codes, so collisions are rare; the loop retries if one happens.
 */
export async function claimRoomCode(presence: Presence): Promise<string> {
  const inUse = new Set(await presence.smembers(CODES_KEY));
  let code: string;
  do {
    code = randomCode();
  } while (inUse.has(code));
  await presence.sadd(CODES_KEY, code);
  return code;
}

export async function releaseRoomCode(presence: Presence, code: string) {
  await presence.srem(CODES_KEY, code);
}
