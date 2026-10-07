// CSV image viewer. Opens as a ChatGPT file viewer when a user opens a .csv
// (desktop app only), or inline when the model calls show_csv_image. Reads the
// CSV, draws it as a table on a canvas, and redraws when the host theme changes.

type Theme = "light" | "dark";
type Table = { name?: string; rows: string[][] };

// Large files are truncated so the canvas stays within browser size limits.
const MAX_ROWS = 200;
const MAX_COLUMNS = 30;
const MAX_COLUMN_WIDTH = 320;
const ROW_HEIGHT = 28;
const PADDING_X = 10;
const FONT = "14px system-ui, sans-serif";
const HEADER_FONT = "600 14px system-ui, sans-serif";

const root = document.getElementById("root")!;
let theme: Theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
let current: Table | null = null;

// --- Minimal MCP Apps bridge (JSON-RPC over postMessage) ---
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
let nextId = 1;

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

    // Both tools deliver their arguments here: { file } when ChatGPT opens a
    // CSV, { csv, name } when the model calls show_csv_image.
    if (msg.method === "ui/notifications/tool-input") {
      loadTable(msg.params?.arguments).then(show).catch(showError);
    }
    if (msg.method === "ui/notifications/host-context-changed") {
      setTheme(msg.params?.theme);
    }
  },
  { passive: true }
);

// MCP Apps handshake: the host sends tool input only after `initialized`.
request("ui/initialize", {
  protocolVersion: "2026-01-26",
  appInfo: { name: "csv-image-viewer", version: "1.0.0" },
  appCapabilities: {},
})
  .then((result) => {
    setTheme(result?.hostContext?.theme);
    window.parent.postMessage(
      { jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} },
      "*"
    );
  })
  .catch(showError);

async function loadTable(args: any): Promise<Table> {
  if (typeof args?.file?.resourceUri === "string") {
    // ChatGPT answers resources/read for opened files itself; the URI is
    // opaque and never reaches the MCP server.
    const result = await request("resources/read", { uri: args.file.resourceUri });
    const content = result?.contents?.[0];
    const text =
      typeof content?.text === "string"
        ? content.text
        : typeof content?.blob === "string"
          ? decodeBase64(content.blob)
          : undefined;
    if (text === undefined) throw new Error("the file has no readable contents");
    return { name: args.file.name, rows: parseCsv(text) };
  }
  if (typeof args?.csv === "string") {
    return { name: typeof args.name === "string" ? args.name : undefined, rows: parseCsv(args.csv) };
  }
  throw new Error("expected an opened file or CSV text");
}

function decodeBase64(blob: string): string {
  const bytes = Uint8Array.from(atob(blob), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// RFC 4180 CSV: quoted fields, escaped quotes ("") and line breaks in quotes.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^﻿/, "");
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}

function setTheme(value: unknown) {
  if (value !== "light" && value !== "dark") return;
  theme = value;
  if (!current) return;
  try {
    show(current);
  } catch (error) {
    showError(error);
  }
}

function show(table: Table) {
  current = table;
  root.replaceChildren();
  root.style.cssText = `font: ${FONT}; padding: 8px; color: ${palette().text}`;
  if (table.name) root.append(caption(table.name));
  if (table.rows.length === 0) {
    root.append(caption("This CSV is empty."));
    return;
  }

  const [header, ...body] = table.rows;
  const columns = table.rows.reduce((n, r) => Math.max(n, r.length), 0);
  const shown = [header, ...body.slice(0, MAX_ROWS)].map((r) => r.slice(0, MAX_COLUMNS));

  const scroller = document.createElement("div");
  scroller.style.overflow = "auto";
  scroller.append(drawTable(shown));
  root.append(scroller);

  if (body.length > MAX_ROWS || columns > MAX_COLUMNS) {
    root.append(
      caption(
        `Showing the first ${Math.min(body.length, MAX_ROWS)} of ${body.length} rows ` +
          `and ${Math.min(columns, MAX_COLUMNS)} of ${columns} columns.`
      )
    );
  }
}

function drawTable(rows: string[][]): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas drawing isn't available");

  const columns = rows.reduce((n, r) => Math.max(n, r.length), 0);
  const widths: number[] = [];
  for (let c = 0; c < columns; c++) {
    let widest = 0;
    rows.forEach((row, r) => {
      ctx.font = r === 0 ? HEADER_FONT : FONT;
      widest = Math.max(widest, ctx.measureText(row[c] ?? "").width);
    });
    widths.push(Math.min(Math.ceil(widest) + PADDING_X * 2, MAX_COLUMN_WIDTH));
  }
  const width = widths.reduce((sum, w) => sum + w, 0);
  const height = rows.length * ROW_HEIGHT;

  // Draw at device resolution so text stays sharp on high-DPI screens.
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", `Table with ${rows.length - 1} rows and ${columns} columns`);
  ctx.scale(scale, scale);

  const colors = palette();
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = "middle";

  rows.forEach((row, r) => {
    const y = r * ROW_HEIGHT;
    if (r === 0 || r % 2 === 0) {
      ctx.fillStyle = r === 0 ? colors.header : colors.stripe;
      ctx.fillRect(0, y, width, ROW_HEIGHT);
    }
    ctx.font = r === 0 ? HEADER_FONT : FONT;
    ctx.fillStyle = colors.text;
    let x = 0;
    widths.forEach((w, c) => {
      ctx.fillText(fit(ctx, row[c] ?? "", w - PADDING_X * 2), x + PADDING_X, y + ROW_HEIGHT / 2);
      x += w;
    });
  });

  // Grid lines on half pixels so they stay crisp.
  ctx.strokeStyle = colors.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let r = 1; r < rows.length; r++) {
    ctx.moveTo(0, r * ROW_HEIGHT + 0.5);
    ctx.lineTo(width, r * ROW_HEIGHT + 0.5);
  }
  let x = 0;
  for (const w of widths.slice(0, -1)) {
    x += w;
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, height);
  }
  ctx.stroke();
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  return canvas;
}

// Truncates text with an ellipsis to fit maxWidth (binary search on length).
function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (ctx.measureText(text.slice(0, mid) + "…").width <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return text.slice(0, low) + "…";
}

function palette() {
  return theme === "dark"
    ? { background: "#1f1f1f", header: "#2b2b2b", stripe: "#262626", grid: "#3a3a3a", text: "#ececec" }
    : { background: "#ffffff", header: "#f3f3f3", stripe: "#fafafa", grid: "#dddddd", text: "#1f1f1f" };
}

function caption(text: string): HTMLParagraphElement {
  const p = document.createElement("p");
  p.textContent = text;
  p.style.margin = "4px 0";
  return p;
}

function showError(error: unknown) {
  console.error("CSV viewer failed", error);
  const message =
    error instanceof Error ? error.message : (error as { message?: string })?.message ?? String(error);
  root.replaceChildren(caption(`Couldn't show this CSV: ${message}.`));
}
