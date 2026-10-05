// src/local-http.ts
import { createServer as createHttpServer } from "node:http";
import mcpApp from "./http.js";

const port = Number(process.env.PORT ?? 8787);

async function readBody(request: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

const server = createHttpServer(async (nodeRequest, nodeResponse) => {
  try {
    const host = nodeRequest.headers.host ?? `localhost:${port}`;
    const url = new URL(nodeRequest.url ?? "/", `http://${host}`);
    const headers = new Headers();

    for (const [key, value] of Object.entries(nodeRequest.headers)) {
      if (Array.isArray(value)) {
        headers.set(key, value.join(", "));
      } else if (value !== undefined) {
        headers.set(key, value);
      }
    }

    const method = nodeRequest.method ?? "GET";
    const body = method === "GET" || method === "HEAD" ? undefined : await readBody(nodeRequest);
    const request = new Request(url, {
      method,
      headers,
      body: body && body.length > 0 ? body : undefined
    });

    const response = await mcpApp.fetch(request);
    nodeResponse.statusCode = response.status;
    response.headers.forEach((value, key) => nodeResponse.setHeader(key, value));

    const responseBody = Buffer.from(await response.arrayBuffer());
    nodeResponse.end(responseBody);
  } catch (error) {
    console.error(error);
    nodeResponse.statusCode = 500;
    nodeResponse.end("Internal Server Error");
  }
});

server.listen(port, () => {
  console.error(`SupportDesk MCP HTTP server listening on http://localhost:${port}/mcp`);
});