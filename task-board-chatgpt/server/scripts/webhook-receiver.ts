// Local stand-in for ChatGPT's webhook endpoint, for testing MCP Events.
// Checks Standard Webhooks signatures, echoes verification challenges, and
// logs delivered events. Run: WEBHOOK_SECRET=whsec_... npm run webhook-receiver
import http from "node:http";
import { Webhook } from "standardwebhooks";

const secret = process.env.WEBHOOK_SECRET;
if (!secret) {
  console.error("Set WEBHOOK_SECRET to the whsec_ secret you pass to events/subscribe.");
  process.exit(1);
}
const port = Number(process.env.PORT ?? 4000);
const webhook = new Webhook(secret);

http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let message: { type?: string; challenge?: string };
      try {
        message = webhook.verify(body, {
          "webhook-id": String(req.headers["webhook-id"]),
          "webhook-timestamp": String(req.headers["webhook-timestamp"]),
          "webhook-signature": String(req.headers["webhook-signature"]),
        }) as { type?: string; challenge?: string };
      } catch (error) {
        console.error("Rejected a request with an invalid signature:", (error as Error).message);
        res.writeHead(401).end();
        return;
      }
      const subscription = req.headers["x-mcp-subscription-id"];
      if (message.type === "verification") {
        console.log(`Verified the callback for ${subscription}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ challenge: message.challenge }));
        return;
      }
      console.log(`Event for ${subscription}:`, JSON.stringify(message, null, 2));
      res.writeHead(202).end();
    });
  })
  .listen(port, () => console.log(`Webhook receiver: http://localhost:${port}/webhook`));
