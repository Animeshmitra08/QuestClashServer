import { defineRoom, defineServer } from "@colyseus/core";

import { ROOM_NAME } from "@/net/protocol";

import { QuestRoom } from "./rooms/QuestRoom.ts";

/**
 * The server definition, shared by the entry point (index.ts) and the tests.
 * Rooms are created with `client.create(ROOM_NAME, …)` and joined by code with
 * `client.joinById(code, …)`.
 */
export const server = defineServer({
  rooms: {
    [ROOM_NAME]: defineRoom(QuestRoom),
  },
});
