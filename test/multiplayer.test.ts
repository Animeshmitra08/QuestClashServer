/**
 * End-to-end multiplayer tests: the real server and separate clients over real
 * WebSockets. The clients speak the protocol directly (test/support/TestClient.ts),
 * so this project tests itself without the app.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { type ColyseusTestServer, boot } from "@colyseus/testing";

import { TEMPLE_IDS } from "@/levels/temple";
import { APP_ERROR_CODES, PROTOCOL_VERSION, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "@/net/protocol";

import { server } from "../src/app.ts";
import type { QuestRoom } from "../src/rooms/QuestRoom.ts";
import { type JoinFailure, sleep, TestClient, waitFor } from "./support/TestClient.ts";

// boot() always listens on @colyseus/testing's default port when given a server instance.
const PORT = 2568;
// 127.0.0.1, not localhost: Node resolves localhost to IPv6 first.
const URL = `http://127.0.0.1:${PORT}`;
const KEY_STAND = { x: 8.2, z: 12.3 };
const DIAL_STAND = { x: 2.3, z: -1.2 };

let colyseus: ColyseusTestServer;
const clients: TestClient[] = [];

async function create(name: string, extra: Parameters<typeof TestClient.create>[2] = {}) {
  const client = await TestClient.create(URL, name, extra);
  clients.push(client);
  return client;
}

async function join(code: string, name: string, extra: Parameters<typeof TestClient.join>[3] = {}) {
  const client = await TestClient.join(URL, code, name, extra);
  clients.push(client);
  return client;
}

/** Expect a create/join to be refused, and return why. */
async function refused(attempt: Promise<TestClient>): Promise<JoinFailure> {
  try {
    clients.push(await attempt);
  } catch (failure) {
    return failure as JoinFailure;
  }
  throw new Error("expected the server to refuse");
}

async function startTwoPlayerMatch() {
  const ana = await create("Ana");
  const bo = await join(ana.code, "Bo");
  await waitFor("both in lobby", () => ana.state.players.size === 2 && bo.state.players.size === 2);
  ana.setReady();
  bo.setReady();
  await waitFor("match on both", () => ana.match !== null && bo.match !== null);
  return { ana, bo, code: ana.code };
}

function serverRoom(code: string): QuestRoom {
  return colyseus.getRoomById(code) as unknown as QuestRoom;
}

before(async () => {
  colyseus = await boot(server, PORT);
});

after(async () => {
  await Promise.all(clients.map((client) => client.leave()));
  await colyseus.shutdown();
});

describe("rooms, codes and the lobby", () => {
  it("creates a room with a short code that a second client joins", async () => {
    const ana = await create("Ana");
    assert.ok(ana.code.length === ROOM_CODE_LENGTH && [...ana.code].every((c) => ROOM_CODE_ALPHABET.includes(c)), ana.code);

    const bo = await join(ana.code.toLowerCase(), "Bo"); // codes are case-insensitive
    await waitFor("both see two players", () => ana.state.players.size === 2 && bo.state.players.size === 2);
    assert.equal(bo.state.hostId, ana.id);
    assert.equal(bo.state.phase, "lobby");
    assert.equal(bo.state.players.get(ana.id)?.name, "Ana");
  });

  it("refuses bad codes, bad names and mismatched app versions, with distinct error codes", async () => {
    assert.equal((await refused(TestClient.join(URL, "ZZZZZ", "Lost"))).code, 522);

    const host = await create("Host");
    assert.equal((await refused(TestClient.join(URL, host.code, "   "))).code, APP_ERROR_CODES.invalidName);
    assert.equal(
      (await refused(TestClient.join(URL, host.code, "Old app", { protocolVersion: PROTOCOL_VERSION - 1 }))).code,
      APP_ERROR_CODES.versionMismatch,
    );
    assert.equal(
      (await refused(TestClient.create(URL, "Old app", { protocolVersion: PROTOCOL_VERSION + 1 }))).code,
      APP_ERROR_CODES.versionMismatch,
    );
  });

  it("starts only when every player is ready, then refuses new joiners", async () => {
    const ana = await create("Ana");
    const bo = await join(ana.code, "Bo");
    await waitFor("two players", () => ana.state.players.size === 2);

    ana.setReady();
    await waitFor("Ana ready", () => bo.state.players.get(ana.id)?.ready === true);
    assert.equal(ana.state.phase, "lobby");

    bo.setReady();
    await waitFor("playing", () => ana.state.phase === "playing" && bo.state.phase === "playing");

    const late = await refused(TestClient.join(URL, ana.code, "Late"));
    // Its own code, not Colyseus's "locked" (522), which looks the same as a room that's gone.
    assert.equal(late.code, APP_ERROR_CODES.matchInProgress, JSON.stringify(late));
  });

  it("holds at most five players", async () => {
    const host = await create("P1");
    for (let i = 2; i <= 5; i++) await join(host.code, `P${i}`);
    assert.equal((await refused(TestClient.join(URL, host.code, "P6"))).code, APP_ERROR_CODES.roomFull);
  });

  it("only the host can choose the level", async () => {
    const ana = await create("Ana");
    const bo = await join(ana.code, "Bo");
    await waitFor("two players", () => bo.state.players.size === 2);
    bo.send("selectLevel", { levelId: "cloister-2" });
    await waitFor("Bo refused", () => bo.lastError?.code === "notHost");
    ana.send("selectLevel", { levelId: "cloister-2" });
    await waitFor("level changed", () => bo.state.levelId === "cloister-2");
  });
});

describe("a two-player match", () => {
  it("both clients get the same authoritative match, with both players", async () => {
    const { ana, bo } = await startTwoPlayerMatch();
    assert.deepEqual([...ana.match!.playerOrder].sort(), [ana.id, bo.id].sort());
    assert.deepEqual(ana.match!.playerOrder, bo.match!.playerOrder);
    assert.equal(ana.match!.status, "playing");
    assert.equal(ana.matchLevelId, TEMPLE_IDS.level);
  });

  it("synchronises movement: each client sees where the other walked", async () => {
    const { ana, bo } = await startTwoPlayerMatch();
    const end = await ana.walk([{ x: 0, z: 7 }]);
    await waitFor("Bo sees Ana arrive", () => {
      const seen = bo.positionOf(ana.id);
      return seen !== null && Math.hypot(seen.x - end.x, seen.z - end.z) < 0.1;
    });
  });

  it("the server, not the client, decides where a player can be: a teleport is clamped", async () => {
    const { ana } = await startTwoPlayerMatch();
    for (let i = 0; i < 5; i++) {
      ana.move(0, -12.2); // straight to the exit, through the locked door
      await sleep(50);
    }
    const accepted = ana.positionOf(ana.id)!;
    assert.ok(accepted.z > 5, `server accepted z=${accepted.z}`);
    assert.equal(ana.match!.players[ana.id].status, "active"); // not escaped
  });

  it("the server decides item collection: out of reach is refused; a simultaneous grab has one winner", async () => {
    const { ana, bo } = await startTwoPlayerMatch();
    const far = await bo.command({ type: "collectItem", pickupId: TEMPLE_IDS.key });
    assert.deepEqual([far.accepted, !far.accepted && far.reason], [false, "outOfReach"]);

    await Promise.all([
      ana.walk([{ x: 0, z: 12.3 }, KEY_STAND]),
      bo.walk([{ x: 0.5, z: 12.4 }, { x: 7.6, z: 12.5 }]),
    ]);
    const [a, b] = await Promise.all([
      ana.command({ type: "collectItem", pickupId: TEMPLE_IDS.key }),
      bo.command({ type: "collectItem", pickupId: TEMPLE_IDS.key }),
    ]);
    assert.equal([a, b].filter((r) => r.accepted).length, 1, JSON.stringify([a, b]));
    const loser = a.accepted ? b : a;
    assert.equal(!loser.accepted && loser.reason, "alreadyCollected");

    const winner = a.accepted ? ana.id : bo.id;
    await waitFor("both see who has the key", () =>
      [ana, bo].every((client) => client.match?.world.collectedPickups[TEMPLE_IDS.key] === winner),
    );
    assert.equal(ana.match!.players[winner].inventory.length, 1);
  });

  it("the server validates puzzle answers", async () => {
    const { ana, bo } = await startTwoPlayerMatch();
    await ana.walk([{ x: 2.3, z: 8 }, DIAL_STAND]);
    const answer = (optionIndex: number) =>
      ana.command({ type: "submitPuzzleAnswer", puzzleId: TEMPLE_IDS.sunPuzzle, optionIndex });

    const invalid = await answer(9);
    assert.equal(!invalid.accepted && invalid.reason, "invalidAnswer");
    const wrong = await answer(0);
    assert.deepEqual([wrong.accepted, wrong.accepted && wrong.correct], [true, false]);
    const right = await answer(2);
    assert.deepEqual([right.accepted, right.accepted && right.correct], [true, true]);
    await waitFor("solved for everyone", () => bo.match?.world.puzzles[TEMPLE_IDS.sunPuzzle].status === "solved");
  });

  it("ignores malformed messages instead of crashing", async () => {
    const { ana } = await startTwoPlayerMatch();
    (ana.room.send as (type: string, message: unknown) => void)("move", { x: "fast", z: null });
    (ana.room.send as (type: string, message: unknown) => void)("command", { requestId: 1, command: { type: "fly" } });
    await sleep(200);
    assert.equal(ana.state.phase, "playing");
    const result = await ana.command({ type: "interact", targetId: TEMPLE_IDS.tablet });
    assert.equal(!result.accepted && result.reason, "outOfReach"); // still answering normally
  });
});

describe("disconnects", () => {
  it("a dropped player keeps their seat and comes back as the same player", async () => {
    const { ana, bo } = await startTwoPlayerMatch();
    const boId = bo.id;
    bo.dropConnection();
    await waitFor("Ana sees Bo disconnected", () => ana.state.players.get(boId)?.connected === false);
    await waitFor("Bo reconnected", () => bo.connected && ana.state.players.get(boId)?.connected === true, 10000);
    assert.equal(bo.id, boId);
    assert.equal(ana.match!.players[boId].status, "active");
  });

  it("a player who leaves on purpose is removed from the match for everyone", async () => {
    const { ana, bo } = await startTwoPlayerMatch();
    const boId = bo.id;
    await bo.leave();
    await waitFor("Ana sees Bo leave", () => ana.match?.players[boId]?.status === "left");
    await waitFor("lobby list updated", () => !ana.state.players.get(boId));
  });
});

describe("stage progression", () => {
  it("completes when everyone escapes; only the host moves the room on to the next level", async () => {
    const { ana, bo, code } = await startTwoPlayerMatch();
    const room = serverRoom(code);
    const exit = { x: 0, z: -12.2 };
    // Test shortcut: put both players at the exit on the server (walking the whole temple takes ~40 s).
    for (const id of [ana.id, bo.id]) {
      (room as unknown as { match: { guards: Map<string, { reset(p: object, t: number): void }> } }).match.guards.get(id)!.reset(exit, Date.now());
    }
    await waitFor("completed on both", () => ana.match?.status === "completed" && bo.match?.status === "completed");
    await waitFor("room finished", () => ana.state.phase === "finished");

    bo.send("nextLevel", {});
    await waitFor("non-host refused", () => bo.lastError?.code === "notHost");

    const before = ana.matchNumber;
    ana.send("nextLevel", {});
    await waitFor("next level on both", () => ana.matchLevelId === "cloister-2" && bo.matchLevelId === "cloister-2");
    assert.equal(ana.matchNumber, before + 1);
    await waitFor("room playing again", () => ana.state.phase === "playing" && bo.state.phase === "playing");
    assert.equal(ana.match!.status, "playing");
  });
});
