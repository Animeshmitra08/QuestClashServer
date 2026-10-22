# QuestClash server

The authoritative multiplayer server for QuestClash, built on [Colyseus](https://docs.colyseus.io/) 0.18.

It is a **standalone Node.js project**. It has no dependency on the Expo app's folder, so you can move it anywhere, put it in its own Git repository, and deploy it on its own (for example to Render).

## What it does

- **Rooms:** rooms of up to 5 players, each with a short code (for example `K7QPM`) that friends join with.
- **Lobby:** players mark themselves ready, and the host picks the level. The match starts when every connected player is ready, and the room then locks to new players.
- **Authority:** the server decides items, puzzle answers, doors, traps, exits, score, objectives and stage progression (the host chooses replay or next level).
- **Movement:** each client moves its own player and reports its position 15 times a second. The server checks every report against walking speed and the walls before using it, so a modified client can't teleport or walk through a closed door. Positions are synced to everyone with Colyseus state patches.
- **Disconnects:** a dropped connection keeps its seat for 30 seconds, and the SDK reconnects automatically as the same player. A deliberate leave, or not returning in time, removes the player and puts their items back in the world.
- **Version check:** a client built for a different protocol version is refused with a clear "update the app" error.

## Shared game code

`src/shared/` is this project's own copy of the game rules, levels, types and network protocol. The app has an identical copy in its `src/` folder. When you change a rule, level or message, change it in both, and bump `PROTOCOL_VERSION` in `src/shared/net/protocol.ts` (on both sides) if old clients must not connect. See `src/shared/README.md`.

## Requirements

- Node.js 22 or newer (Colyseus 0.18 requires it).

## Run locally

```bash
npm install
npm run dev            # development: restarts when you edit files; port 2567
```

Production:

```bash
npm run build          # bundles src/ (including src/shared) into dist/index.js
npm start              # node dist/index.js
```

### Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `2567` | Port to listen on (HTTP and WebSocket). Render sets this for you. |
| `HOST` | `0.0.0.0` | Interface to bind. Keep `0.0.0.0` for Render and for phones on your Wi-Fi. |

There are no secrets, and no database is used.

## Deploy to Render

1. Put this folder in its own Git repository (GitHub, GitLab or Bitbucket) and push it. Its `.gitignore` already leaves out `node_modules/` and `dist/`.
2. In Render, choose **New → Blueprint** and pick the repository. `render.yaml` creates a web service. To set it up by hand instead, choose **New → Web Service** with:
   - **Runtime:** Node
   - **Build command:** `npm ci && npm run build`
   - **Start command:** `npm start`
   - **Health check path:** `/`
   - **Environment variable:** `NODE_VERSION=22`
3. When it's live, Render shows a URL such as `https://questclash-server.onrender.com`. In the app, set:

   ```
   EXPO_PUBLIC_GAME_SERVER_URL=https://questclash-server.onrender.com
   ```

   Then restart `npx expo start --clear`. With `https://`, the client uses secure WebSockets (`wss://`) automatically.

If this folder stays inside the app's repository, create the service by hand and set **Root Directory** to `server`. Render only reads `render.yaml` from a repository's root.

**Free plan:** the service sleeps after about 15 minutes without traffic. The first connection after that takes up to a minute while it wakes, and open matches end when it sleeps. A paid instance stays on.

## Check

```bash
npm run typecheck
```

## Files

```
src/index.ts                    entry point (PORT / HOST)
src/app.ts                      server definition
src/rooms/QuestRoom.ts          the room: lobby, codes, ready, matches, commands, reconnection
src/rooms/QuestRoomState.ts     synced state (players' bodies, lobby); checked against the protocol at compile time
src/rooms/messageValidation.ts  checks every client message before it is used
src/rooms/roomCodes.ts          unique short room codes
src/match/MovementGuard.ts      checks reported positions (speed, walls)
src/shared/                     game rules, levels, types, protocol (this project's copy)
render.yaml                     Render blueprint
```

## Scaling note

One server process handles many rooms. Room codes are tracked with Colyseus's in-memory presence, so running several instances would need Colyseus's Redis presence and driver. That isn't needed for the initial version.
