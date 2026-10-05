// src/support-service.ts

export interface Ticket {
  id: string;
  title: string;
  customer: string;
  status: "open" | "in_progress" | "resolved";
  priority: "low" | "medium" | "high";
  description: string;
}

// Seed varying mock ticket data
const tickets: Map<string, Ticket> = new Map([
  ["T-100", { id: "T-100", title: "Login failure", customer: "Acme Corp", status: "open", priority: "high", description: "User cannot log in via SSO." }],
  ["T-101", { id: "T-101", title: "Billing report bug", customer: "Globex", status: "in_progress", priority: "medium", description: "Exported PDF is missing the total column." }],
  ["T-102", { id: "T-102", title: "Update API keys", customer: "Acme Corp", status: "resolved", priority: "low", description: "Rotated production API keys." }]
]);

export function searchTickets(query?: string, status?: string, priority?: string): Ticket[] {
  return Array.from(tickets.values()).filter(t => {
    const matchQuery = query ? t.title.toLowerCase().includes(query.toLowerCase()) : true;
    const matchStatus = status ? t.status === status : true;
    const matchPriority = priority ? t.priority === priority : true;
    return matchQuery && matchStatus && matchPriority;
  });
}

export function getTicket(id: string): Ticket | undefined {
  return tickets.get(id);
}

export function updateTicketStatus(id: string, status: "open" | "in_progress" | "resolved"): Ticket | undefined {
  const ticket = tickets.get(id);
  if (!ticket) return undefined;
  ticket.status = status;
  return ticket;
}

export function getQueueSummary() {
  const all = Array.from(tickets.values());
  return {
    open: all.filter(t => t.status === "open").length,
    in_progress: all.filter(t => t.status === "in_progress").length,
    resolved: all.filter(t => t.status === "resolved").length,
    high_priority: all.filter(t => t.priority === "high").length
  };
}