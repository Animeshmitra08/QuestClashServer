// Starts the built server (dist/index.js) and two separate client processes
// (scripts/client-bot.ts), then checks what each client saw. Run `npm run build` first.
//   npm run smoke
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = process.env.SMOKE_PORT ?? "2570";
const URL = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), "questclash-smoke-"));
const codeFile = join(dir, "code.txt");

/**
 * `shell` is only for npx on Windows (npx is a .cmd file there). The server must be
 * spawned without a shell, or kill() would stop the shell and leave the server running.
 */
function run(command, args, env = {}, { shell = false } = {}) {
  const child = spawn(command, args, { env: { ...process.env, ...env }, shell });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const done = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  return { child, done, output: () => output };
}

const results = (text) =>
  text
    .split("\n")
    .filter((line) => line.startsWith("RESULT "))
    .map((line) => JSON.parse(line.slice(7)));

const server = run(process.execPath, ["dist/index.js"], { PORT });
const npxShell = { shell: process.platform === "win32" };
let exitCode = 1;
try {
  const start = Date.now();
  while (!server.output().includes("listening")) {
    if (Date.now() - start > 10000) throw new Error(`server didn't start:\n${server.output()}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const host = run("npx", ["tsx", "scripts/client-bot.ts", "host", URL, codeFile], {}, npxShell);
  const guest = run("npx", ["tsx", "scripts/client-bot.ts", "guest", URL, codeFile], {}, npxShell);
  const [hostCode, guestCode] = await Promise.all([host.done, guest.done]);

  const hostResults = results(host.output());
  const guestResults = results(guest.output());
  const find = (list, step) => list.find((r) => r.step === step) ?? {};
  const checks = {
    "both clients exited cleanly": hostCode === 0 && guestCode === 0,
    "guest joined the host's room by code": find(guestResults, "joined").code === find(hostResults, "created").code,
    "match started on both with 2 players":
      find(hostResults, "match started").players === 2 && find(guestResults, "match started").players === 2,
    "server accepted the host's key pickup": find(hostResults, "collect key").accepted === true,
    "guest saw the host take the key": find(guestResults, "watched").sawOtherTakeKey === true,
    "guest saw the host at the key (movement sync)":
      Math.hypot((find(guestResults, "watched").otherPositionWhenKeyTaken?.x ?? 0) - 8.2, (find(guestResults, "watched").otherPositionWhenKeyTaken?.z ?? 0) - 12.3) < 0.5,
    "host saw the guest where the guest walked":
      Math.hypot(find(hostResults, "observed").otherPosition.x - find(guestResults, "observed").myPosition.x, find(hostResults, "observed").otherPosition.z - find(guestResults, "observed").myPosition.z) < 0.5,
    "guest saw the host leave and the key return": find(guestResults, "watched").otherStatusAtEnd === "left" && find(guestResults, "watched").keyBackInWorldAfterOtherLeft === true,
  };
  for (const [name, ok] of Object.entries(checks)) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  exitCode = Object.values(checks).every(Boolean) ? 0 : 1;
  if (exitCode !== 0) console.log(`\n--- host\n${host.output()}\n--- guest\n${guest.output()}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
} finally {
  server.child.kill();
  rmSync(dir, { recursive: true, force: true });
}
process.exit(exitCode);
