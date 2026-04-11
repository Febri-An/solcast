import type { NextConfig } from "next";

const rpcWsBase =
  "./node_modules/jito-ts/node_modules/rpc-websockets/dist/lib";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ws"],
  turbopack: {
    resolveAlias: {
      "rpc-websockets/dist/lib/client": `${rpcWsBase}/client.cjs`,
      "rpc-websockets/dist/lib/client/websocket": `${rpcWsBase}/client/websocket.cjs`,
      "rpc-websockets/dist/lib/client/websocket.browser": `${rpcWsBase}/client/websocket.browser.cjs`,
    },
  },
};

export default nextConfig;
