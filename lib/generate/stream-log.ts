export type StreamEvent = { type: string; [k: string]: unknown };

export type ApiCallEvent = StreamEvent & {
  type: "api_call";
  call_id?: string;
  label?: string;
  model?: string;
  status?: string;
  elapsed_ms?: number;
  messages?: Array<{ role?: string; content?: string }>;
  response?: unknown;
  message?: string;
};

export type PairedApiCall = {
  id: string;
  callId: string;
  phase: string;
  label: string;
  model: string;
  status: "running" | "done" | "error";
  legacy: boolean;
  startEvent: ApiCallEvent | null;
  doneEvent: ApiCallEvent | null;
  errorEvent: ApiCallEvent | null;
  startIndex: number;
  endIndex: number;
};

export type PhaseTimelineEventRow = {
  kind: "event";
  id: string;
  label: string;
  detail?: string;
  tone: "info" | "success" | "warning" | "error";
};

export type PhaseTimelineApiCallRow = {
  kind: "api_call";
  id: string;
  callId: string;
  label: string;
  model: string;
  status: "running" | "done" | "error";
  elapsedMs: number | null;
  hasRequest: boolean;
  hasResponse: boolean;
  legacy: boolean;
};

export type PhaseTimelineRow = PhaseTimelineEventRow | PhaseTimelineApiCallRow;

export const GENERATION_PHASES = [
  "0_scope",
  "A_scaffold",
  "B_concepts",
  "C_nodes",
  "D_detailed",
  "D2_ground",
  "E_edges",
  "F_procedures",
  "G_items",
  "H_audit",
] as const;

export const PHASE_DESCRIPTIONS: Record<string, string> = {
  "0_scope": "Freeze the topic boundary and tentative outline.",
  A_scaffold: "Expand scope into a structured section scaffold.",
  B_concepts: "Enumerate concept and procedure candidates by section.",
  C_nodes: "Deduplicate candidates into canonical nodes.",
  D_detailed: "Write precise node descriptions and confidence.",
  D2_ground: "Ground sensitive claims with sources and verification.",
  E_edges: "Generate typed graph edges within and across sections.",
  F_procedures: "Ensure ordered part_of composition for procedures.",
  G_items: "Generate assessment items and method-specific prompts.",
  H_audit: "Run structural and completeness validation checks.",
};

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
  if (event.type === "grounding_node" && typeof event.ref === "string") {
    const verification =
      typeof event.verification === "string" ? event.verification : "unverified";
    const count = typeof event.sources === "number" ? event.sources : 0;
    return `grounding: ${event.ref} -> ${verification} (${count} source${count === 1 ? "" : "s"})`;
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

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asApiCallEvent(event: StreamEvent): ApiCallEvent | null {
  return event.type === "api_call" ? (event as ApiCallEvent) : null;
}

function resolvePairedStatus(call: PairedApiCall): "running" | "done" | "error" {
  if (call.errorEvent) return "error";
  if (call.doneEvent) return "done";
  return "running";
}

function safeJsonSnippet(value: unknown, maxLen = 220): string {
  let raw = "";
  try {
    raw = JSON.stringify(value);
  } catch {
    raw = String(value);
  }
  if (raw.length <= maxLen) return raw;
  return `${raw.slice(0, maxLen)}...`;
}

function summarizeScaffoldSections(event: StreamEvent): string | undefined {
  if (event.type !== "scaffold" || !Array.isArray(event.sections)) return undefined;
  const names = event.sections
    .map((s) =>
      s && typeof s === "object" && typeof (s as { name?: unknown }).name === "string"
        ? String((s as { name: string }).name)
        : null
    )
    .filter((name): name is string => !!name);
  if (names.length === 0) return undefined;
  if (names.length <= 20) return names.join(", ");
  return `${names.slice(0, 20).join(", ")} (+${names.length - 20} more)`;
}

export function formatTimelineEvent(event: StreamEvent): PhaseTimelineEventRow | null {
  if (event.type === "phase" || event.type === "api_call") return null;
  if (event.type === "done") {
    return { kind: "event", id: "done", label: "Generation completed", tone: "success" };
  }
  if (event.type === "error") {
    const msg = asString(event.message) || "Generator error";
    return { kind: "event", id: "error", label: msg, tone: "error" };
  }
  if (event.type === "scaffold" && Array.isArray(event.sections)) {
    return {
      kind: "event",
      id: "scaffold",
      label: `Scaffold created (${event.sections.length} sections)`,
      detail: summarizeScaffoldSections(event),
      tone: "success",
    };
  }
  if (event.type === "enumeration" && typeof event.count === "number") {
    return {
      kind: "event",
      id: "enumeration",
      label: `Enumerated ${event.count} candidates`,
      tone: "success",
    };
  }
  if (event.type === "items" && typeof event.count === "number") {
    return {
      kind: "event",
      id: "items",
      label: `Generated ${event.count} items`,
      tone: "success",
    };
  }
  if (event.type === "procedures" && typeof event.count === "number") {
    return {
      kind: "event",
      id: "procedures",
      label: `Mapped ${event.count} procedure compositions`,
      tone: "success",
    };
  }
  if (event.type === "audit" && typeof event.errors === "number") {
    return {
      kind: "event",
      id: "audit",
      label: event.errors > 0 ? `Audit found ${event.errors} issue(s)` : "Audit passed with no issues",
      tone: event.errors > 0 ? "warning" : "success",
    };
  }
  if (
    event.type === "node" &&
    typeof event.ref === "string" &&
    typeof event.name === "string"
  ) {
    return {
      kind: "event",
      id: `node-${event.ref}`,
      label: `Node ${event.ref}: ${event.name}`,
      tone: "info",
    };
  }
  if (event.type === "node_update" && typeof event.ref === "string") {
    const detail = asString(event.description);
    return {
      kind: "event",
      id: `node-update-${event.ref}`,
      label: `Node updated: ${event.ref}`,
      detail: detail ? safeJsonSnippet(detail, 180) : undefined,
      tone: "info",
    };
  }
  if (
    event.type === "edge" &&
    typeof event.source === "string" &&
    typeof event.target === "string" &&
    typeof event.edge_type === "string"
  ) {
    return {
      kind: "event",
      id: `edge-${event.source}-${event.target}-${event.edge_type}`,
      label: `Edge ${event.source} -> ${event.target} (${event.edge_type})`,
      tone: "info",
    };
  }
  if (event.type === "grounding_node" && typeof event.ref === "string") {
    const verification = asString(event.verification) || "unverified";
    const sourceCount = asNumber(event.sources) ?? 0;
    return {
      kind: "event",
      id: `grounding-${event.ref}`,
      label: `Grounding ${event.ref}: ${verification} (${sourceCount} source${sourceCount === 1 ? "" : "s"})`,
      tone: verification === "grounded" ? "success" : "warning",
    };
  }
  return {
    kind: "event",
    id: "event",
    label: safeJsonSnippet(event),
    tone: "info",
  };
}

export function pairApiCalls(events: StreamEvent[]): PairedApiCall[] {
  const callsById = new Map<string, PairedApiCall>();
  const legacyStacks = new Map<string, string[]>();
  const paired: PairedApiCall[] = [];
  let currentPhase = "0_scope";
  let legacyCounter = 0;

  function createCall(
    id: string,
    callId: string,
    phase: string,
    label: string,
    model: string,
    legacy: boolean,
    index: number
  ): PairedApiCall {
    const call: PairedApiCall = {
      id,
      callId,
      phase,
      label,
      model,
      status: "running",
      legacy,
      startEvent: null,
      doneEvent: null,
      errorEvent: null,
      startIndex: index,
      endIndex: index,
    };
    callsById.set(id, call);
    paired.push(call);
    return call;
  }

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.type === "phase" && typeof event.name === "string") {
      currentPhase = event.name;
      continue;
    }

    const api = asApiCallEvent(event);
    if (!api) continue;

    const label = asString(api.label) || "api_call";
    const model = asString(api.model) || "unknown";
    const status = asString(api.status) || "start";
    const callId = asString(api.call_id);
    let call: PairedApiCall | undefined;

    if (callId) {
      call = callsById.get(callId);
      if (!call) {
        call = createCall(callId, callId, currentPhase, label, model, false, index);
      }
    } else if (status === "start") {
      legacyCounter += 1;
      const legacyId = `legacy-${legacyCounter}`;
      call = createCall(legacyId, legacyId, currentPhase, label, model, true, index);
      const stackKey = `${currentPhase}::${label}`;
      const stack = legacyStacks.get(stackKey) || [];
      stack.push(legacyId);
      legacyStacks.set(stackKey, stack);
    } else {
      const stackKey = `${currentPhase}::${label}`;
      const stack = legacyStacks.get(stackKey) || [];
      const maybeLegacyId = stack.pop();
      if (stack.length > 0) {
        legacyStacks.set(stackKey, stack);
      } else {
        legacyStacks.delete(stackKey);
      }
      if (maybeLegacyId) {
        call = callsById.get(maybeLegacyId);
      }
      if (!call) {
        legacyCounter += 1;
        const legacyId = `legacy-${legacyCounter}`;
        call = createCall(legacyId, legacyId, currentPhase, label, model, true, index);
      }
    }

    if (!call) continue;
    if (!call.startEvent) {
      call.startIndex = Math.min(call.startIndex, index);
    }
    call.endIndex = Math.max(call.endIndex, index);
    if (status === "start") {
      call.startEvent = api;
    } else if (status === "done") {
      call.doneEvent = api;
    } else if (status === "error") {
      call.errorEvent = api;
    } else if (!call.startEvent) {
      call.startEvent = api;
    }
    call.phase = call.phase || currentPhase;
    call.label = call.label || label;
    call.model = call.model || model;
    call.status = resolvePairedStatus(call);
  }

  paired.sort((a, b) => {
    if (a.startIndex !== b.startIndex) return a.startIndex - b.startIndex;
    return a.id.localeCompare(b.id);
  });
  return paired;
}

export function buildPhaseTimeline(events: StreamEvent[], phase: string): PhaseTimelineRow[] {
  const rows: PhaseTimelineRow[] = [];
  const calls = pairApiCalls(events).filter((call) => call.phase === phase);
  const callsByIndex = new Map<number, PairedApiCall[]>();
  for (const call of calls) {
    const keyIndex = call.startEvent ? call.startIndex : call.endIndex;
    const atIndex = callsByIndex.get(keyIndex) || [];
    atIndex.push(call);
    callsByIndex.set(keyIndex, atIndex);
  }

  let currentPhase = "0_scope";
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.type === "phase" && typeof event.name === "string") {
      currentPhase = event.name;
      continue;
    }
    if (currentPhase !== phase) continue;

    const callRows = callsByIndex.get(index) || [];
    for (const call of callRows) {
      const doneOrError = call.errorEvent || call.doneEvent;
      rows.push({
        kind: "api_call",
        id: call.id,
        callId: call.callId,
        label: call.label,
        model: call.model,
        status: call.status,
        elapsedMs: asNumber(doneOrError?.elapsed_ms),
        hasRequest: Array.isArray(call.startEvent?.messages),
        hasResponse: doneOrError?.response !== undefined,
        legacy: call.legacy,
      });
    }

    if (event.type === "api_call") continue;
    const row = formatTimelineEvent(event);
    if (row) {
      rows.push({ ...row, id: `${row.id}-${index}` });
    }
  }

  return rows;
}
