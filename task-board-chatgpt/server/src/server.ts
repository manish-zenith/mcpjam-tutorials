// MCP server definition for the task board ChatGPT App: data tools
// (list_tasks, complete_task), the render tool (show_task_board), and the
// UI resource that serves the bundled web component.
import { McpServer } from "@modelcontextprotocol/server";
import {
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { readFileSync } from "node:fs";
import { z } from "zod";

const WIDGET_URI = "ui://task-board/v1.html";

const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  done: z.boolean(),
});

const TaskListSchema = z.object({ tasks: z.array(TaskSchema) });

// In-memory data for the tutorial. Use a real data store in production.
const tasks = [
  { id: "t1", title: "Write the launch post", done: false },
  { id: "t2", title: "Review the pricing page", done: false },
  { id: "t3", title: "Book the team offsite", done: true },
];

export function createServer() {
  const server = new McpServer(
    { name: "task-board", version: "1.0.0" },
    {
      instructions:
        "Call list_tasks to get tasks. To show tasks visually, call list_tasks first, then pass its tasks to show_task_board.",
    }
  );

  // Data tool: read-only, no UI attached.
  server.registerTool(
    "list_tasks",
    {
      title: "List tasks",
      description:
        "Use this when the user wants to find or review their tasks. Returns tasks with id, title, and done status.",
      inputSchema: z.object({ status: z.enum(["open", "done"]).optional() }),
      outputSchema: TaskListSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ status }) => {
      const result = tasks.filter((t) =>
        status === undefined ? true : status === "done" ? t.done : !t.done
      );
      return {
        structuredContent: { tasks: result },
        content: [{ type: "text", text: `Found ${result.length} tasks.` }],
      };
    }
  );

  // Data tool: changes state, called by the model or from the UI.
  server.registerTool(
    "complete_task",
    {
      title: "Complete task",
      description: "Use this when the user wants to mark a task as done.",
      inputSchema: z.object({ taskId: z.string() }),
      outputSchema: TaskListSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ taskId }) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) {
        return {
          isError: true,
          content: [{ type: "text", text: `No task found with id ${taskId}.` }],
        };
      }
      task.done = true;
      return {
        structuredContent: { tasks },
        content: [{ type: "text", text: `Marked "${task.title}" as done.` }],
      };
    }
  );

  registerRenderTool(server);
  registerWidget(server);
  return server;
}

function registerRenderTool(server: McpServer) {
  server.registerTool(
    "show_task_board",
    {
      title: "Show task board",
      description:
        "Render the task board UI. Always call list_tasks first, then pass its tasks to this tool.",
      inputSchema: TaskListSchema,
      outputSchema: TaskListSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: {
        ui: { resourceUri: WIDGET_URI },
        "openai/toolInvocation/invoking": "Opening task board…",
        "openai/toolInvocation/invoked": "Task board ready.",
      },
    },
    async ({ tasks }) => ({
      structuredContent: { tasks },
      content: [{ type: "text", text: `Showing ${tasks.length} tasks.` }],
    })
  );
}

function registerWidget(server: McpServer) {
  const component = readFileSync(
    new URL("../../web/dist/component.js", import.meta.url),
    "utf8"
  );

  registerAppResource(server, "task-board", WIDGET_URI, {}, async () => ({
    contents: [
      {
        uri: WIDGET_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: `<div id="root"></div><script type="module">${component}</script>`,
        _meta: {
          ui: {
            prefersBorder: true,
            // This widget makes no external requests, so both lists are empty.
            csp: { connectDomains: [], resourceDomains: [] },
          },
        },
      },
    ],
  }));
}
