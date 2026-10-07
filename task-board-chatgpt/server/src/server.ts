// MCP server definition for the task board ChatGPT App: data tools
// (list_tasks, complete_task), the render tool (show_task_board), and the
// UI resource that serves the bundled web component. Also a CSV image viewer:
// a .csv file viewer extension (open_csv_file), a model-callable version
// (show_csv_image), its UI resource, and the task list as a CSV resource.
import { McpServer } from "@modelcontextprotocol/server";
import {
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { readFileSync } from "node:fs";
import { z } from "zod";

const WIDGET_URI = "ui://task-board/v1.html";
const CSV_VIEWER_URI = "ui://task-board/csv-viewer-v1.html";
const TASKS_CSV_URI = "tasks://tasks.csv";

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

  registerCsvFileViewer(server);
  registerCsvImageTool(server);
  registerCsvViewerResource(server);
  registerTasksCsvResource(server);
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

// Plugin extension: a file viewer that shows any opened .csv as a table image.
// ChatGPT (desktop app only) calls this tool with the opened file, and the UI
// reads the file through the host.
function registerCsvFileViewer(server: McpServer) {
  server.registerTool(
    "open_csv_file",
    {
      title: "Table image",
      description: "Show an opened CSV file as a table image.",
      inputSchema: z.object({
        file: z.object({ name: z.string(), resourceUri: z.string() }),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: {
        // "app" hides the tool from the model. ChatGPT ignores this when it
        // opens the tool as a file viewer.
        ui: { resourceUri: CSV_VIEWER_URI, visibility: ["app"] },
        "openai/ui": {
          entrypoints: [{ type: "file", extensions: [".csv"] }],
        },
      },
    },
    async ({ file }) => ({
      content: [{ type: "text", text: `Showing ${file.name} as a table image.` }],
    })
  );
}

// The same viewer, called by the model with the CSV text, so it also works
// where file viewers don't: ChatGPT on the web and on mobile.
function registerCsvImageTool(server: McpServer) {
  server.registerTool(
    "show_csv_image",
    {
      title: "Show CSV as image",
      description:
        "Use this when the user wants to see CSV data as a table image. Pass the full CSV text, including the header row.",
      inputSchema: z.object({
        csv: z.string().min(1),
        name: z.string().optional().describe("File name to show above the image, if known."),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: {
        ui: { resourceUri: CSV_VIEWER_URI },
        "openai/toolInvocation/invoking": "Drawing table…",
        "openai/toolInvocation/invoked": "Table image ready.",
      },
    },
    async ({ name }) => ({
      content: [{ type: "text", text: `Showing ${name ?? "the CSV"} as a table image.` }],
    })
  );
}

function registerCsvViewerResource(server: McpServer) {
  registerAppResource(server, "csv-viewer", CSV_VIEWER_URI, {}, async () => {
    // Read on demand, so a missing bundle only breaks the viewer, not the board.
    const viewer = readFileSync(
      new URL("../../web/dist/csv-viewer.js", import.meta.url),
      "utf8"
    );
    return {
      contents: [
        {
          uri: CSV_VIEWER_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: `<div id="root"></div><script type="module">${viewer}</script>`,
          _meta: {
            ui: {
              prefersBorder: true,
              csp: { connectDomains: [], resourceDomains: [] },
            },
          },
        },
      ],
    };
  });
}

// The task list as CSV. In ChatGPT the file viewer reads opened files through
// the host, but MCPJam sends resources/read here, so invoke open_csv_file with
// { "file": { "name": "tasks.csv", "resourceUri": "tasks://tasks.csv" } } to test it.
function registerTasksCsvResource(server: McpServer) {
  server.registerResource(
    "tasks-csv",
    TASKS_CSV_URI,
    { title: "Tasks as CSV", mimeType: "text/csv" },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/csv", text: tasksCsv() }],
    })
  );
}

function tasksCsv(): string {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const rows = tasks.map((t) => [quote(t.id), quote(t.title), t.done].join(","));
  return ["id,title,done", ...rows].join("\n");
}
