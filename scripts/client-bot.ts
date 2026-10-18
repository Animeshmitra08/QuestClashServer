/**
 * A scripted player, for testing with separate client processes against a running
 * server (see two-client-smoke.mjs). Speaks the protocol through test/support/TestClient.
 *
 *   npx tsx scripts/client-bot.ts host <serverUrl> <codeFile>   create a room, write its code to codeFile
 *   npx tsx scripts/client-bot.ts guest <serverUrl> <codeFile>  join the room whose code is in codeFile
 *
 * Both ready up; the host walks to the key and picks it up, then leaves; the guest
 * walks a few steps and watches. Each prints what it saw as `RESULT <json>` lines.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { TEMPLE_IDS } from "@/levels/temple";

import { sleep, TestClient, waitFor } from "../test/support/TestClient.ts";

const [role, serverUrl, codeFile] = process.argv.slice(2);
if ((role !== "host" && role !== "guest") || !serverUrl || !codeFile) {
  console.error("usage: client-bot.ts host|guest <serverUrl> <codeFile>");
  process.exit(2);
}

const report = (data: object) => console.log(`RESULT ${JSON.stringify({ role, ...data })}`);
const rounded = (p: { x: number; z: number } | null) => (p ? { x: +p.x.toFixed(2), z: +p.z.toFixed(2) } : null);

let client: TestClient | null = null;
try {
  if (role === "host") {
    client = await TestClient.create(serverUrl, "Host bot");
    writeFileSync(codeFile, client.code);
    report({ step: "created", code: client.code });
  } else {
    await waitFor("room code file", () => existsSync(codeFile) && readFileSync(codeFile, "utf8").length > 0, 15000);
    const code = readFileSync(codeFile, "utf8").trim();
    client = await TestClient.join(serverUrl, code, "Guest bot");
    report({ step: "joined", code });
  }
  const me = client;

  await waitFor("two players in the lobby", () => me.state.players.size === 2, 15000);
  me.setReady();
  await waitFor("match start", () => me.match !== null, 15000);
  let other = "";
  me.state.players.forEach((_, id) => {
    if (id !== me.id) other = id;
  });
  report({ step: "match started", players: me.match!.playerOrder.length, level: me.matchLevelId });

  let myPosition = me.positionOf(me.id)!;
  if (role === "host") {
    myPosition = await me.walk([{ x: 0, z: 12.3 }, { x: 8.2, z: 12.3 }]);
    const result = await me.command({ type: "collectItem", pickupId: TEMPLE_IDS.key });
    report({ step: "collect key", accepted: result.accepted, reason: result.accepted ? null : result.reason });
    await sleep(3000);
  } else {
    myPosition = await me.walk([{ x: myPosition.x, z: 6 }]);
    // Watch the shared world while the host plays: the host takes the key, then leaves,
    // and a player who leaves puts their items back in the world.
    let sawOtherTakeKey = false;
    let otherPositionWhenKeyTaken: { x: number; z: number } | null = null;
    for (let i = 0; i < 180; i++) {
      if (!sawOtherTakeKey && me.match?.world.collectedPickups[TEMPLE_IDS.key] === other) {
        sawOtherTakeKey = true;
        otherPositionWhenKeyTaken = rounded(me.positionOf(other));
      }
      await sleep(50);
    }
    report({
      step: "watched",
      sawOtherTakeKey,
      otherPositionWhenKeyTaken,
      otherStatusAtEnd: me.match?.players[other]?.status,
      keyBackInWorldAfterOtherLeft: me.match?.world.collectedPickups[TEMPLE_IDS.key] === undefined,
    });
  }

  report({
    step: "observed",
    me: me.id,
    myPosition: rounded(myPosition),
    otherPosition: rounded(me.positionOf(other)),
    keyHolder: ((holder) => (holder === undefined ? null : holder === me.id ? "me" : "other"))(
      me.match?.world.collectedPickups[TEMPLE_IDS.key],
    ),
  });
} catch (error) {
  const message = error instanceof Error ? error.message : JSON.stringify(error);
  console.error(`FAILED ${role}: ${message}`);
  process.exitCode = 1;
} finally {
  await client?.leave();
}
