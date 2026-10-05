# Task Board

A small ChatGPT App built on the Model Context Protocol (MCP). The server exposes task tools. A React widget renders the tasks inside the chat and lets you mark them done. With ChatGPT plugin extensions, users can also open the board from the sidebar or beside a conversation, and selecting a task shares it with the model.

## Structure

```
.
├── server/          MCP server (Express + @modelcontextprotocol/server)
│   └── src/
│       ├── index.ts     HTTP entry point, serves /mcp on port 3000
│       └── server.ts    Tools and the UI resource
└── web/             Widget UI (React, bundled with esbuild)
    └── src/
        └── component.tsx
```

## Tools

| Tool              | Purpose                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------- |
| `list_tasks`      | Returns tasks, optionally filtered by `status` (`open`/`done`).                               |
| `complete_task`   | Marks a task as done by `taskId`.                                                             |
| `show_task_board` | Renders the task board widget (`ui://task-board/v1.html`).                                    |
| `open_task_board` | Plugin extension entrypoint (`global` sidebar app and `thread` panel). Hidden from the model. |

Tasks live in memory, so any change is lost when the server restarts.

## Getting started

Requires Node.js 22+.

1. Build the widget. `npm run build` bundles and minifies it into `web/dist/component.js` (about 140 KB), which the server reads, so do this first:

   ```bash
   cd web
   npm install
   npm run build
   ```

2. Start the server:

   ```bash
   cd server
   npm install
   npm start
   ```

   The MCP endpoint is at `http://localhost:3000/mcp`.

3. Test it with [MCPJam](https://github.com/MCPJam/inspector), which emulates the ChatGPT client locally, so you don't need a tunnel or a ChatGPT account:

   ```bash
   npx @mcpjam/inspector@latest
   ```

   Add an HTTP server at `http://localhost:3000/mcp`, then invoke `show_task_board` from the Playground to render the widget. Invoke `open_task_board` with `{}` to render the entrypoint view. MCPJam doesn't emulate ChatGPT's sidebar or conversation panels, so check those in ChatGPT.

   To run it inside ChatGPT instead, you need developer mode and a public HTTPS tunnel. Add the tunnel URL plus `/mcp` as a connector.

Run `npm run build` in `web/` again after each UI change. The server reads the bundle on every request, so you don't need to restart it.
