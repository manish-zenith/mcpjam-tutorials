// src/http.ts
import { createMcpHandler, requireBearerAuth, hostHeaderValidationResponse } from "@modelcontextprotocol/server";
import { createServer } from "./server.js";

// createMcpHandler calls this factory for each HTTP request, so return a fresh
// McpServer instance. Shared app dependencies should live outside this factory.
const mcpHandler = createMcpHandler(() => createServer(), { legacy: "reject" });

const mockTokenVerifier = {
  async verifyAccessToken(token: string) {
    // Expires 1 hour from now. The SDK expects seconds since epoch, not milliseconds.
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;

    if (token === "dev-read-token") {
      return { scopes: ["tickets:read"], expiresAt, token, clientId: "mock-client" };
    }
    if (token === "dev-write-token") {
      return { scopes: ["tickets:read", "tickets:write"], expiresAt, token, clientId: "mock-client" };
    }
    throw new Error("Invalid token"); // Triggers an automatic 401 response
  }
};

const gate = requireBearerAuth({
  verifier: mockTokenVerifier,
  requiredScopes: ["tickets:read"] // Base requirement to connect
});

export default {
  async fetch(request: Request) {
    const url = new URL(request.url);
    if (url.pathname === "/mcp") {
      
      const hostValidation = hostHeaderValidationResponse(request, ["localhost", "127.0.0.1"]);
      if (hostValidation instanceof Response) return hostValidation;

      // Protect the endpoint using standard bearer authentication
      let authResult: Awaited<ReturnType<typeof gate>>;
      try {
        authResult = await gate(request);
      } catch {
        return new Response("Invalid token", {
          status: 401,
          headers: {
            "WWW-Authenticate": 'Bearer error="invalid_token", error_description="Invalid token"'
          }
        });
      }

      if (authResult instanceof Response) {
        if (authResult.status >= 500) {
          return new Response("Invalid token", {
            status: 401,
            headers: {
              "WWW-Authenticate": 'Bearer error="invalid_token", error_description="Invalid token"'
            }
          });
        }
        return authResult; // Returns standard 401 or 403 challenge response
      }

      // Securely pass the verified auth info directly into the handler context
      return mcpHandler.fetch(request, { authInfo: authResult as any });
    }
    return new Response("Not Found", { status: 404 });
  }
};
