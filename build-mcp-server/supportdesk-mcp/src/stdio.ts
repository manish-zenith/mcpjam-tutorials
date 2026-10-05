// src/stdio.ts
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./server.js";

const server = createServer();

async function run() {
  await serveStdio(() => server, { legacy: "reject" });
}

run().catch(console.error);