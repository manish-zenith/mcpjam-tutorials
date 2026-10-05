// Task board UI component. Renders tool results delivered over the MCP Apps
// bridge (JSON-RPC over postMessage), calls complete_task via tools/call, keeps
// the selected row in ChatGPT widget state when available, and shares the
// selected task with the model via ui/update-model-context.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

type Task = { id: string; title: string; done: boolean };
type ToolResult = { structuredContent?: { tasks?: Task[] } } | null;

declare global {
  interface Window {
    openai?: {
      widgetState?: { selectedId?: string | null };
      setWidgetState?: (state: unknown) => void;
    };
  }
}

// --- Minimal MCP Apps bridge (JSON-RPC over postMessage) ---
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
let nextId = 1;
const listeners = new Set<(result: ToolResult) => void>();

function request(method: string, params: unknown): Promise<any> {
  const id = nextId++;
  window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

window.addEventListener(
  "message",
  (event) => {
    if (event.source !== window.parent) return;
    const msg = event.data;
    if (!msg || msg.jsonrpc !== "2.0") return;

    // Responses to our own requests
    if (msg.id !== undefined && pending.has(msg.id)) {
      const p = pending.get(msg.id)!;
      pending.delete(msg.id);
      msg.error ? p.reject(msg.error) : p.resolve(msg.result);
      return;
    }

    // Tool results pushed by the host
    if (msg.method === "ui/notifications/tool-result") {
      listeners.forEach((fn) => fn(msg.params ?? null));
    }
  },
  { passive: true }
);

function useToolResult() {
  const [result, setResult] = useState<ToolResult>(null);
  useEffect(() => {
    listeners.add(setResult);
    return () => {
      listeners.delete(setResult);
    };
  }, []);
  return result;
}

// --- UI ---
function TaskBoard() {
  const toolResult = useToolResult();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    window.openai?.widgetState?.selectedId ?? null
  );

  useEffect(() => {
    // Treat tool results as untrusted input.
    const incoming = toolResult?.structuredContent?.tasks;
    if (Array.isArray(incoming)) setTasks(incoming);
  }, [toolResult]);

  function select(id: string) {
    setSelectedId(id);
    window.openai?.setWidgetState?.({ selectedId: id });

    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    request("ui/update-model-context", {
      content: [{ type: "text", text: `Selected task: "${task.title}" (id ${task.id})` }],
    }).catch((error) => console.warn("Couldn't update model context", error));
  }

  async function complete(id: string) {
    try {
      const result = await request("tools/call", {
        name: "complete_task",
        arguments: { taskId: id },
      });
      if (result?.isError) throw new Error("Tool returned an error");
      setTasks(result.structuredContent.tasks);
      setError(null);
    } catch {
      setError("Couldn't update that task. Please try again.");
    }
  }

  if (tasks.length === 0) {
    return <p style={{ padding: 12 }}>No tasks to show.</p>;
  }

  return (
    <div style={{ fontFamily: "system-ui", padding: 12 }}>
      {error && <p role="alert">{error}</p>}
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {tasks.map((task) => (
          <li
            key={task.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
              padding: 8,
              borderRadius: 8,
              background: selectedId === task.id ? "rgba(0,0,0,0.06)" : "transparent",
            }}
          >
            <button
              type="button"
              aria-pressed={selectedId === task.id}
              onClick={() => select(task.id)}
              style={{
                all: "unset",
                cursor: "pointer",
                textDecoration: task.done ? "line-through" : "none",
              }}
            >
              {task.title}
            </button>
            {!task.done && (
              <button type="button" onClick={() => complete(task.id)}>
                Done
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<TaskBoard />);
