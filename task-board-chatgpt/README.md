# Task Board

A small ChatGPT App built on the Model Context Protocol (MCP). The server exposes task tools. A React widget renders the tasks inside the chat and lets you mark them done.

It also includes a CSV image viewer: a ChatGPT plugin extension that shows any opened `.csv` as a table image, plus a tool the model can call to draw the same image from CSV text.

And it sends an MCP event, `task.completed`, whenever a task is marked done, so ChatGPT can subscribe to it and run an automation.

## Structure

```
.
├── server/          MCP server (Express + @modelcontextprotocol/server)
│   ├── scripts/
│   │   └── webhook-receiver.ts    Local stand-in for ChatGPT's webhook endpoint
│   └── src/
│       ├── index.ts     HTTP entry point, serves /mcp on port 3000
│       ├── server.ts    Tools, UI resources, and the tasks CSV resource
│       └── events.ts    MCP Events: task.completed subscriptions and signed webhooks
└── web/             Widget UI (React, bundled with esbuild)
    └── src/
        ├── component.tsx    Task board
        └── csv-viewer.ts    CSV image viewer
```

## Tools

| Tool              | Purpose                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| `list_tasks`      | Returns tasks, optionally filtered by `status` (`open`/`done`).                                       |
| `complete_task`   | Marks a task as done by `taskId`.                                                                     |
| `show_task_board` | Renders the task board widget (`ui://task-board/v1.html`).                                            |
| `open_csv_file`   | File viewer extension for `.csv` files. Opens in the ChatGPT desktop app only. Hidden from the model. |
| `show_csv_image`  | Draws CSV text passed by the model as a table image. Works on the web and mobile.                     |

Tasks live in memory, so any change is lost when the server restarts.

## Getting started

Requires Node.js 22+.

1. Build the widget. `npm run build` bundles and minifies the task board and the CSV viewer into `web/dist/component.js` and `web/dist/csv-viewer.js`, which the server reads, so do this first:

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

   Add an HTTP server at `http://localhost:3000/mcp`, then invoke `show_task_board` from the Playground to render the widget.

   To test the CSV viewer, invoke `show_csv_image` with `{ "csv": "name,qty\nbolts,4" }`. To test the file-viewer path, invoke `open_csv_file` with `{ "file": { "name": "tasks.csv", "resourceUri": "tasks://tasks.csv" } }`. MCPJam reads that sample resource from this server; ChatGPT reads the opened file itself.

   To run it inside ChatGPT instead, you need developer mode and a public HTTPS tunnel. Add the tunnel URL plus `/mcp` as a connector. On the web, attach a CSV and ask "Show this CSV as an image". The `.csv` file viewer only appears in the ChatGPT desktop app.

Run `npm run build` in `web/` again after each UI change. The server reads the bundle on every request, so you don't need to restart it.

## Test MCP Events locally

ChatGPT only accepts HTTPS callbacks on public addresses, so the server refuses anything else. For local testing, start it with `ALLOW_LOCAL_CALLBACKS=1` and use the included webhook receiver in place of ChatGPT.

1. Create a signing secret and start the receiver:

   ```bash
   cd server
   export WEBHOOK_SECRET="whsec_$(openssl rand -base64 32)"
   npm run webhook-receiver
   ```

2. In another terminal, start the server with local callbacks allowed:

   ```bash
   cd server
   ALLOW_LOCAL_CALLBACKS=1 npm start
   ```

3. In a third terminal, export the same `WEBHOOK_SECRET`, then subscribe and complete a task:

   ```bash
   mcp() {
     curl -s http://localhost:3000/mcp \
       -H "Content-Type: application/json" \
       -H "Accept: application/json, text/event-stream" \
       -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":$2}"
   }
   mcp events/subscribe '{"name":"task.completed","arguments":{},"delivery":{"mode":"webhook","url":"http://localhost:4000/webhook","secret":"'"$WEBHOOK_SECRET"'"}}'
   mcp tools/call '{"name":"complete_task","arguments":{"taskId":"t2"}}'
   ```

   The receiver logs the verification challenge, then the signed `task.completed` event. Clicking **Done** on the board in MCPJam sends the same event.

Subscriptions live in memory, like the tasks, and there's no sign-in. In ChatGPT, events work in Work chats on the web, or in the desktop app with **Work** and **Cloud** selected.
