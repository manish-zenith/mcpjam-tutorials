// src/server.ts
import { McpServer, ResourceNotFoundError, ResourceTemplate } from "@modelcontextprotocol/server";
import { z } from "zod";
import * as supportService from "./support-service.js";

export interface AppContext {
  authInfo?: {
    scopes: string[];
  };
  http?: {
    authInfo?: {
      scopes: string[];
    };
  };
}

function scopesFromContext(context: AppContext | undefined): string[] | undefined {
  return context?.http?.authInfo?.scopes ?? context?.authInfo?.scopes;
}

export function createServer() {
  const server = new McpServer({
    name: "SupportDesk",
    version: "1.0.0"
  }, {
    instructions: "Use search_tickets before get_ticket unless the user already provided an exact ticket ID. Only update ticket status when the caller is authorized for tickets:write."
  });

  // Tools, Resources, and Prompts will be registered here
    server.registerTool(
    "search_tickets",
    {
      description: "Search for support tickets by query, status, or priority.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        query: z.string().optional().describe("Text to search in the ticket title"),
        status: z.enum(["open", "in_progress", "resolved"]).optional(),
        priority: z.enum(["low", "medium", "high"]).optional()
      }
    },
    async (args) => {
      const results = supportService.searchTickets(args.query, args.status, args.priority);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
      };
    }
  );

    server.registerTool(
    "get_ticket",
    {
      description: "Retrieve a specific support ticket by its exact ID.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        id: z.string().describe("The exact ticket ID (e.g., T-100)")
      }
    },
    async (args) => {
      const ticket = supportService.getTicket(args.id);
      if (!ticket) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error: Ticket ID ${args.id} not found.` }]
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(ticket, null, 2) }]
      };
    }
  );

    server.registerTool(
    "update_ticket_status",
    {
      description: "Update the status of a specific support ticket.",
      annotations: { destructiveHint: true },
      inputSchema: {
        id: z.string(),
        status: z.enum(["open", "in_progress", "resolved"])
      }
    },
    async (args, context: AppContext) => {
      // HTTP attaches a bearer token. Stdio does not, so local Inspector runs can
      // exercise the write. A present token must include tickets:write.
      const scopes = scopesFromContext(context);
      if (scopes !== undefined && !scopes.includes("tickets:write")) {
        throw new Error("Unauthorized: tickets:write scope is missing.");
      }

      const updated = supportService.updateTicketStatus(args.id, args.status);
      if (!updated) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error: Cannot update. Ticket ${args.id} not found.` }]
        };
      }
      return {
        content: [{ type: "text", text: `Success. Ticket updated:\n${JSON.stringify(updated, null, 2)}` }]
      };
    }
  );

    server.registerResource(
    "queue-summary",
    "support://queue-summary",
    {
      description: "Summary of the support queue",
      mimeType: "application/json",
      cacheHint: { ttlMs: 60000, cacheScope: "public" }
    },
    async () => {
      const summary = supportService.getQueueSummary();
      return {
        contents: [{
          uri: "support://queue-summary",
          mimeType: "application/json",
          text: JSON.stringify(summary, null, 2)
        }]
      };
    }
  );

    server.registerResource(
    "ticket-lookup",
    new ResourceTemplate("support://tickets/{id}", { list: undefined }),
    {
      description: "Look up a support ticket by ID",
      mimeType: "application/json",
      cacheHint: { ttlMs: 30000, cacheScope: "private" }
    },
    async (uri, variables) => {
      const id = String(variables.id);
      const ticket = supportService.getTicket(id);
      if (!ticket) {
        throw new ResourceNotFoundError(uri.href, `Resource not found: Ticket ${id}`);
      }
      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(ticket, null, 2)
        }]
      };
    }
  );

    server.registerPrompt(
    "triage-ticket",
    {
      description: "Instructions for triaging a specific support ticket.",
      argsSchema: {
        id: z.string().describe("The ticket ID to triage")
      }
    },
    async (args) => {
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Please review ticket ${args.id}. Assess its urgency, summarize the core issue, and propose a next action for the support team.`
            }
          }
        ]
      };
    }
  );

  return server;
}