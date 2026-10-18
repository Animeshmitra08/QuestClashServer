# Shared game code (server copy)

These files are the game rules, levels, types and network protocol. The Expo app keeps an identical copy in its own `src/` folder. The server has its own copy so it can live in its own repository and deploy on its own (for example to Render), with no dependency on the app's folder.

Keep the two copies in step:

- Change a rule, level or message on both sides.
- If old apps must not connect to the new server, or new apps to an old server, bump `PROTOCOL_VERSION` in `net/protocol.ts` on both sides. The server refuses clients with a different version and tells them to update.

The folder layout matches the app's `src/`, and imports use the same `@/…` paths (mapped to this folder in `tsconfig.json`). That way a file can be copied over unchanged in either direction.
