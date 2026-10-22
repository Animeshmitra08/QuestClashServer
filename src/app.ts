import { defineRoom, defineServer } from "@colyseus/core";

import { ROOM_NAME } from "@/net/protocol";

import { QuestRoom } from "./rooms/QuestRoom.ts";

/**
 * The server definition, started by the entry point (index.ts).
 * Rooms are created with `client.create(ROOM_NAME, …)` and joined by code with
 * `client.joinById(code, …)`.
 */
export const server = defineServer({
  rooms: {
    [ROOM_NAME]: defineRoom(QuestRoom),
  },
});
