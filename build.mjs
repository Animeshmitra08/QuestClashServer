// Production build: bundles the server and its shared game code (src/shared, via the
// "@/" alias in tsconfig.json) into dist/index.js. npm packages stay external, so a
// deploy needs dist/ plus package.json, then `npm ci --omit=dev && npm start`.
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  tsconfig: "tsconfig.json",
  sourcemap: true,
  logLevel: "info",
});
