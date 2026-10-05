# Build MCP Server

This repository contains a TypeScript example MCP server for a fictional support product called SupportDesk. It exposes support-ticket workflows through the Model Context Protocol using the official MCP TypeScript SDK.

The runnable project lives in `supportdesk-mcp/`.

## What It Includes

- A shared MCP server factory with tools, resources, and a prompt
- A local stdio transport for MCP clients and inspectors
- A local HTTP transport with bearer-token authentication
- Mock SupportDesk ticket data and service functions
- Screenshots in `screenshots/`

## MCP Features

Tools:

- `search_tickets`
- `get_ticket`
- `update_ticket_status`

Resources:

- `support://queue-summary`
- `support://tickets/{id}`

Prompt:

- `triage-ticket`

## Getting Started

```bash
cd supportdesk-mcp
npm install
npm run typecheck
```

Run the stdio transport:

```bash
npm run dev:stdio
```

Run the local HTTP transport:

```bash
npm run dev:http
```

The HTTP MCP endpoint runs at:

```text
http://localhost:8787/mcp
```

Use `Authorization: Bearer dev-read-token` for read-only tests and `Authorization: Bearer dev-write-token` for update tests.

## Quick HTTP Smoke Test

With `npm run dev:http` running:

```bash
curl -i http://localhost:8787/mcp
```

A `401 Unauthorized` response means the endpoint is live and refusing unauthenticated traffic.

To confirm that MCP tool discovery works:

```bash
curl -sS -X POST http://localhost:8787/mcp \
  -H 'Authorization: Bearer dev-read-token' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2026-07-28' \
  -H 'Mcp-Method: tools/list' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{},"io.modelcontextprotocol/clientInfo":{"name":"curl-smoke-test","version":"1.0.0"}}}}'
```

The response should include `search_tickets`, `get_ticket`, and `update_ticket_status`.

## MCPJam Inspector

From the `supportdesk-mcp/` directory:

```bash
npx -y @mcpjam/inspector@latest --no-open npx tsx "$PWD/src/stdio.ts"
```

If a browser does not open automatically, visit:

```text
http://localhost:6274
```

The server is working when the Inspector discovers the tools, resources, prompt, server metadata, and protocol details.
