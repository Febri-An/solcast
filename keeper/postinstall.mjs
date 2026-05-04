/**
 * Postinstall shim for the keeper.
 *
 * jito-ts (transitive dependency of @pythnetwork/pyth-solana-receiver)
 * ships a nested rpc-websockets@7 whose `dist/lib/*` files use the `.cjs`
 * extension. Node's CJS resolver does not auto-discover `.cjs`, so the
 * legacy imports from jito-ts's bundled @solana/web3.js@1.77 fail.
 *
 * Next.js works around this with turbopack aliases (see next.config.ts).
 * For the keeper (which runs under plain tsx/Node), we drop thin `.js`
 * shims that re-export the `.cjs` files so require() resolves them.
 *
 * Runs on every `npm install` so VPS deployments work out of the box.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JITO_WS_LIB = path.resolve(
  HERE,
  "..",
  "node_modules",
  "jito-ts",
  "node_modules",
  "rpc-websockets",
  "dist",
  "lib",
);

if (!fs.existsSync(JITO_WS_LIB)) {
  // rpc-websockets not nested (e.g. during a slim install). Nothing to do.
  process.exit(0);
}

const SHIMS = [
  {
    dir: JITO_WS_LIB,
    file: "client.js",
    target: "./client.cjs",
  },
  {
    dir: path.join(JITO_WS_LIB, "client"),
    file: "websocket.js",
    target: "./websocket.cjs",
  },
];

for (const { dir, file, target } of SHIMS) {
  if (!fs.existsSync(dir)) continue;
  const cjsPath = path.join(dir, path.basename(target));
  if (!fs.existsSync(cjsPath)) continue;
  const outPath = path.join(dir, file);
  fs.writeFileSync(outPath, `module.exports = require('${target}');\n`);
  console.log(`[keeper/postinstall] shim ${path.relative(process.cwd(), outPath)} -> ${target}`);
}
