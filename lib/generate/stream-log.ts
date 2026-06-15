export type StreamEvent = { type: string; [k: string]: unknown };

export const GENERATION_PHASES = [
  "0_scope",
  "A_scaffold",
  "B_concepts",
  "C_nodes",
  "D_detailed",
  "E_edges",
  "F_procedures",
  "G_items",
  "H_audit",
] as const;

/** Convert a stream event to the same log line shown during live generation. */
export function formatStreamEvent(event: StreamEvent): string | null {
  if (event.type === "api_call") return null;

  if (event.type === "phase" && typeof event.name === "string") {
    return `▶ phase: ${event.name}`;
  }
  if (event.type === "done") return "✓ done";
  if (event.type === "error") {
    const msg = typeof event.message === "string" ? event.message : JSON.stringify(event);
    return `✗ error: ${msg}`;
  }
  if (
    event.type === "node" &&
    typeof event.ref === "string" &&
    typeof event.name === "string"
  ) {
    return `node: ${event.ref} (${event.name})`;
  }
  if (event.type === "node_update" && typeof event.ref === "string") {
    return `node_update: ${event.ref}`;
  }
  if (
    event.type === "edge" &&
    typeof event.source === "string" &&
    typeof event.target === "string" &&
    typeof event.edge_type === "string"
  ) {
    return `edge: ${event.source} -> ${event.target} (${event.edge_type})`;
  }
  if (event.type === "scaffold" && Array.isArray(event.sections)) {
    return `scaffold: ${event.sections.length} sections`;
  }
  if (event.type === "enumeration" && typeof event.count === "number") {
    return `enumeration: ${event.count} candidates`;
  }
  if (event.type === "items" && typeof event.count === "number") {
    return `items: ${event.count} generated`;
  }
  if (event.type === "procedures" && typeof event.count === "number") {
    return `procedures: ${event.count} members`;
  }
  if (event.type === "audit" && typeof event.errors === "number") {
    return `audit: ${event.errors} errors`;
  }
  return `event: ${JSON.stringify(event)}`;
}

export type PhaseLogGroup = {
  phase: string;
  lines: string[];
};

export function groupStreamEventsByPhase(events: StreamEvent[]): PhaseLogGroup[] {
  const groups: PhaseLogGroup[] = [];
  let current: PhaseLogGroup | null = null;

  for (const event of events) {
    if (event.type === "phase" && typeof event.name === "string") {
      current = { phase: event.name, lines: [] };
      groups.push(current);
    }
    const line = formatStreamEvent(event);
    if (line === null) continue;
    if (!current) {
      current = { phase: "0_scope", lines: [] };
      groups.push(current);
    }
    current.lines.push(line);
  }
  return groups;
}

export function parseStreamNdjson(raw: string): StreamEvent[] {
  const events: StreamEvent[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as StreamEvent);
    } catch {
      // Skip malformed lines from partial writes.
    }
  }
  return events;
}
