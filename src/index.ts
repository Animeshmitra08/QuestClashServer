import { server } from "./app.ts";

/**
 * Entry point. Configuration comes from environment variables only:
 *   PORT  port to listen on (default 2567)
 *   HOST  interface to bind (default 0.0.0.0, so phones on the same network can connect)
 */
const port = Number(process.env.PORT ?? 2567);
const host = process.env.HOST ?? "0.0.0.0";

await server.listen(port, host);
console.log(`QuestClash server listening on ws://${host}:${port}`);
