// MCP Events for the task board: a task.completed event that ChatGPT can
// subscribe to from Work chats. Implements events/list, events/subscribe, and
// events/unsubscribe, verifies callback URLs, and delivers signed webhooks.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { lookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import {
  INVALID_PARAMS,
  McpServer,
  ProtocolError,
  type ServerCapabilities,
} from "@modelcontextprotocol/server";
import { Webhook } from "standardwebhooks";
import { z } from "zod";

const TASK_COMPLETED = {
  name: "task.completed",
  description: "A task on the task board was marked as done.",
  delivery: ["webhook"],
  inputSchema: {
    type: "object",
    properties: {
      task_id: {
        type: "string",
        description: "Only report this task. Omit to report every completed task.",
      },
    },
    additionalProperties: false,
  },
  payloadSchema: {
    type: "object",
    properties: {
      task_id: { type: "string" },
      title: { type: "string" },
    },
    required: ["task_id", "title"],
    additionalProperties: false,
  },
};

const ArgumentsSchema = z.object({ task_id: z.string().optional() }).strict();
type EventArguments = z.infer<typeof ArgumentsSchema>;

type Subscription = {
  id: string;
  arguments: EventArguments;
  url: string;
  secret: string;
  expiresAt: number;
};

// In-memory for the tutorial, like the tasks. ChatGPT expects subscriptions to
// survive restarts, so use persistent storage in production.
const subscriptions = new Map<string, Subscription>();
const verifiedCallbacks = new Map<string, number>();

// Without sign-in there's no user to own a subscription, so every subscription
// belongs to one principal. With OAuth, use the authenticated user's ID.
const PRINCIPAL = "unauthenticated";
// Local testing only: allow http:// and private-network callback URLs.
const ALLOW_LOCAL_CALLBACKS = process.env.ALLOW_LOCAL_CALLBACKS === "1";

const CALLBACK_ENDPOINT_ERROR = -32015;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_TTL_MS = 60 * 1000;
const VERIFICATION_CACHE_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_EVENT_BYTES = 256 * 1024;
const RETRY_DELAYS_MS = [1_000, 5_000, 25_000];

const SubscribeParams = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()).nullish(),
  delivery: z.object({ mode: z.literal("webhook"), url: z.string(), secret: z.string() }),
  cursor: z.string().nullish(),
  ttlMs: z.number().int().positive().nullish(),
});

const UnsubscribeParams = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()).nullish(),
  delivery: z.object({ mode: z.literal("webhook"), url: z.string() }),
});

export function registerEvents(server: McpServer) {
  // The SDK's types don't include the draft events capability yet, but the
  // SDK passes it through to server/discover.
  const capabilities: Record<string, unknown> = { events: {} };
  server.server.registerCapabilities(capabilities as ServerCapabilities);
  server.server.setRequestHandler(
    "events/list",
    { params: z.object({ cursor: z.string().nullish() }) },
    async () => ({ events: [TASK_COMPLETED] })
  );
  server.server.setRequestHandler("events/subscribe", { params: SubscribeParams }, subscribe);
  server.server.setRequestHandler("events/unsubscribe", { params: UnsubscribeParams }, unsubscribe);
}

async function subscribe(params: z.infer<typeof SubscribeParams>) {
  const args = parseArguments(params.name, params.arguments);
  if (!isValidSecret(params.delivery.secret)) {
    throw new ProtocolError(
      INVALID_PARAMS,
      "The signing secret must be whsec_ followed by 24 to 64 base64-encoded bytes."
    );
  }
  const url = validateCallbackUrl(params.delivery.url);
  const id = subscriptionId(params.name, args, url);
  await verifyCallback(id, url, params.delivery.secret);

  // Subscribing again with the same identity refreshes the subscription.
  const ttl = grantedTtl(params.ttlMs);
  const expiresAt = Date.now() + ttl;
  subscriptions.set(id, { id, arguments: args, url: url.href, secret: params.delivery.secret, expiresAt });
  return {
    id,
    refreshBefore: new Date(expiresAt).toISOString(),
    // task.completed doesn't support replay.
    cursor: null,
    truncated: false,
  };
}

async function unsubscribe(params: z.infer<typeof UnsubscribeParams>) {
  const args = parseArguments(params.name, params.arguments);
  const url = URL.canParse(params.delivery.url) ? new URL(params.delivery.url) : null;
  if (url) subscriptions.delete(subscriptionId(params.name, args, url));
  return {};
}

// Call after a task changes from open to done.
export function emitTaskCompleted(task: { id: string; title: string }) {
  const now = Date.now();
  for (const sub of subscriptions.values()) {
    if (sub.expiresAt <= now) {
      subscriptions.delete(sub.id);
      continue;
    }
    if (sub.arguments.task_id !== undefined && sub.arguments.task_id !== task.id) continue;
    const event = {
      eventId: `evt_${randomUUID()}`,
      name: TASK_COMPLETED.name,
      timestamp: new Date(now).toISOString(),
      data: { task_id: task.id, title: task.title },
      cursor: null,
    };
    deliver(sub, event).catch((error) => console.error(`Delivery to ${sub.id} failed`, error));
  }
}

function parseArguments(name: string, args: unknown): EventArguments {
  if (name !== TASK_COMPLETED.name) {
    throw new ProtocolError(INVALID_PARAMS, `Unknown event: ${name}`);
  }
  const parsed = ArgumentsSchema.safeParse(args ?? {});
  if (!parsed.success) {
    throw new ProtocolError(INVALID_PARAMS, `Invalid arguments for ${name}: ${parsed.error.message}`);
  }
  return parsed.data;
}

function isValidSecret(secret: string): boolean {
  if (!secret.startsWith("whsec_")) return false;
  const bytes = Buffer.from(secret.slice("whsec_".length), "base64");
  return bytes.length >= 24 && bytes.length <= 64;
}

// The same principal, callback, event, and arguments always map to the same
// ID. Arguments are flat, so sorting their keys makes the JSON canonical.
function subscriptionId(name: string, args: EventArguments, url: URL): string {
  const sortedArgs = Object.fromEntries(Object.entries(args).sort(([a], [b]) => (a < b ? -1 : 1)));
  const identity = JSON.stringify([PRINCIPAL, url.href, name, sortedArgs]);
  return `sub_${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}

// No ttlMs: the default lifetime. ttlMs null asks for no expiry, which this
// server doesn't grant. Otherwise grant what was asked, but at least
// MIN_TTL_MS so refreshes don't arrive too often.
function grantedTtl(ttlMs: number | null | undefined): number {
  if (ttlMs == null) return DEFAULT_TTL_MS;
  return Math.max(Math.min(ttlMs, DEFAULT_TTL_MS), MIN_TTL_MS);
}

function callbackError(reason: string, message: string) {
  return new ProtocolError(CALLBACK_ENDPOINT_ERROR, message, { reason });
}

function validateCallbackUrl(raw: string): URL {
  if (!URL.canParse(raw)) throw callbackError("invalid_url", "The callback URL isn't a valid URL.");
  const url = new URL(raw);
  const allowedProtocol = url.protocol === "https:" || (ALLOW_LOCAL_CALLBACKS && url.protocol === "http:");
  if (!allowedProtocol) throw callbackError("invalid_url", "The callback URL must use HTTPS.");
  // An IP address in the URL skips DNS lookup, so check it here.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !isPublicAddress(host) && !ALLOW_LOCAL_CALLBACKS) {
    throw callbackError("invalid_url", "The callback URL must point at a public address.");
  }
  return url;
}

// POSTs a signed challenge and requires the callback to echo it back.
async function verifyCallback(subscriptionId: string, url: URL, secret: string) {
  const cacheKey = `${PRINCIPAL} ${url.href}`;
  const verifiedAt = verifiedCallbacks.get(cacheKey);
  if (verifiedAt !== undefined && Date.now() - verifiedAt < VERIFICATION_CACHE_MS) return;

  const challenge = randomBytes(24).toString("base64url");
  const body = JSON.stringify({ type: "verification", challenge });
  const headers = signedHeaders(subscriptionId, `msg_verification_${randomUUID()}`, body, secret);
  let response: { status: number; body: string };
  try {
    response = await postJson(url, headers, body);
  } catch (error) {
    console.error(`Callback verification for ${url.href} failed`, error);
    if (errorCode(error) === "ENONPUBLIC") {
      throw callbackError("invalid_url", "The callback URL must point at a public address.");
    }
    throw callbackError(errorCode(error) === "ETIMEDOUT" ? "timeout" : "unreachable", "Couldn't reach the callback URL.");
  }
  if (response.status < 200 || response.status >= 300 || !echoesChallenge(response.body, challenge)) {
    throw callbackError("challenge_failed", "The callback didn't echo the verification challenge.");
  }
  verifiedCallbacks.set(cacheKey, Date.now());
}

function echoesChallenge(body: string, expected: string): boolean {
  let echoed: unknown;
  try {
    echoed = JSON.parse(body)?.challenge;
  } catch {
    return false;
  }
  if (typeof echoed !== "string") return false;
  const a = Buffer.from(echoed);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Retries network errors, 408, 429, and 5xx with backoff. 410 means the
// subscription is gone, so it's removed. The event ID stays the same across
// attempts, but each attempt gets a fresh timestamp and signature.
async function deliver(sub: Subscription, event: { eventId: string }) {
  const body = JSON.stringify(event);
  if (Buffer.byteLength(body) > MAX_EVENT_BYTES) throw new Error("Event payload exceeds 256 KiB");
  const url = new URL(sub.url);
  for (let attempt = 0; ; attempt++) {
    const result = await postJson(url, signedHeaders(sub.id, event.eventId, body, sub.secret), body).catch(
      (error: Error) => error
    );
    if (!(result instanceof Error)) {
      if (result.status >= 200 && result.status < 300) return;
      if (result.status === 410) {
        subscriptions.delete(sub.id);
        return;
      }
    }
    const transient =
      result instanceof Error || result.status === 408 || result.status === 429 || result.status >= 500;
    if (!transient || attempt >= RETRY_DELAYS_MS.length) {
      throw result instanceof Error ? result : new Error(`Callback answered ${result.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
  }
}

function signedHeaders(subscriptionId: string, messageId: string, body: string, secret: string) {
  const signedAt = new Date();
  return {
    "Content-Type": "application/json",
    "webhook-id": messageId,
    "webhook-timestamp": String(Math.floor(signedAt.getTime() / 1000)),
    "webhook-signature": new Webhook(secret).sign(messageId, signedAt, body),
    "X-MCP-Subscription-Id": subscriptionId,
  };
}

// node:http doesn't follow redirects, and safeLookup checks the resolved
// address at connection time, while TLS still verifies the original hostname.
function postJson(url: URL, headers: Record<string, string>, body: string) {
  const client = url.protocol === "https:" ? https : http;
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = client.request(
      url,
      {
        method: "POST",
        headers: { ...headers, "Content-Length": String(Buffer.byteLength(body)) },
        lookup: safeLookup,
        timeout: REQUEST_TIMEOUT_MS,
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          if (text.length < 64 * 1024) text += chunk;
        });
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body: text }));
      }
    );
    request.on("timeout", () => request.destroy(Object.assign(new Error("Request timed out"), { code: "ETIMEDOUT" })));
    request.on("error", reject);
    request.end(body);
  });
}

function errorCode(error: unknown): string | undefined {
  return (error as { code?: string })?.code;
}

const nonPublic = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  nonPublic.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) {
  nonPublic.addSubnet(network, prefix, "ipv6");
}

function isPublicAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return !nonPublic.check(mapped[1], "ipv4");
  return !nonPublic.check(address, isIP(address) === 6 ? "ipv6" : "ipv4");
}

const safeLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "", 0);
    const list = addresses as LookupAddress[];
    const blocked = list.find((a) => !isPublicAddress(a.address));
    if (blocked && !ALLOW_LOCAL_CALLBACKS) {
      const error = Object.assign(new Error(`Blocked non-public callback address ${blocked.address}`), {
        code: "ENONPUBLIC",
      });
      return callback(error, "", 0);
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
};
