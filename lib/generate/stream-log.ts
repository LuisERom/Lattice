export type StreamEvent = { type: string; [k: string]: unknown };

/** Current Doc 4 pipeline phase ids (checkpoint filenames). */
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
  "B_seeds",
  "C_expand",
  "D_detailed",
  "D2_ground",
  "E_edges",
  "F_procedures",
  "G_items",
  "H_audit",
] as const;

/** Older enumerate-then-link checkpoints still present in some artifact dirs. */
export const LEGACY_GENERATION_PHASES = ["B_concepts", "C_nodes"] as const;

/** Short titles shown in progress UI and history. */
export const PHASE_LABELS: Record<string, string> = {
  "0_scope": "Define the topic",
  A_scaffold: "Outline the skill areas",
  B_seeds: "Set learning goals",
  C_expand: "Build the learning path",
  D_detailed: "Write concept explanations",
  D2_ground: "Check risky claims against sources",
  E_edges: "Connect related concepts",
  F_procedures: "Spell out procedures",
  G_items: "Write practice questions",
  H_audit: "Final quality check",
  B_concepts: "List concepts (legacy)",
  C_nodes: "Merge duplicates (legacy)",
  done: "Done",
};

/**
 * Plain-language explanations for each phase.
 * Aimed at someone watching generation, not reading the pipeline docs.
 */
export const PHASE_DESCRIPTIONS: Record<string, string> = {
  "0_scope":
    "Lock in what this topic is about — what belongs in it, and what should stay out.",
  A_scaffold:
    "Split the topic into big skill areas (like chapters), so the map has a clear shape.",
  B_seeds:
    "In each area, pick a few end goals — the things a learner should eventually be able to do.",
  C_expand:
    "Working backward from those goals, find what must be learned first, step by step.",
  D_detailed:
    "Write a clear explanation for every concept that made it onto the map.",
  D2_ground:
    "Attach sources to risky claims, and leave the rest explicitly unverified.",
  E_edges:
    "Add useful links between related ideas (beyond just “learn this before that”).",
  F_procedures:
    "For multi-step skills, list the steps in the order they should be done.",
  G_items:
    "Create practice questions so each concept and skill can be reviewed later.",
  H_audit:
    "Scan the finished map for gaps, broken links, and weak spots before import.",
  B_concepts: "Older pipeline step: list concepts section by section.",
  C_nodes: "Older pipeline step: merge concepts that mean the same thing.",
  done: "Generation finished — the topic map is ready.",
};

/** Human labels for LLM/embed call tags. */
export const CALL_LABELS: Record<string, string> = {
  SCOPE_INTERVIEW: "asking a scope question",
  PHASE_A_SCAFFOLD: "drafting skill areas",
  PHASE_A_CRITIC: "checking for missing skill areas",
  PHASE_B_SEEDS: "proposing learning goals",
  PHASE_B_SEED_CRITIC: "checking for missing goals",
  PHASE_B_ENUMERATE: "listing concepts (legacy)",
  PHASE_B_GAP_CRITIC: "checking the concept list (legacy)",
  PHASE_C_EXPAND: "asking what comes before a concept",
  PHASE_C_ADJUDICATE: "merging duplicates (legacy)",
  PHASE_D_DETAIL: "writing concept descriptions",
  PHASE_D_AUDITOR: "reviewing description quality",
  PHASE_D2_GROUND: "checking a claim against sources",
  PHASE_E_SECTION: "linking ideas within a section",
  PHASE_E_NODE: "linking ideas across sections",
  PHASE_E_CRITIC: "checking for missing or wrong links",
  PHASE_E_COVERAGE: "connecting leftover isolated concepts",
  PHASE_F_PROCEDURE: "choosing steps for a procedure",
  PHASE_G_ITEM: "writing a review question",
  PHASE_H_CRITIC: "checking completeness",
  EMBEDDINGS: "comparing similar concepts",
  LLM_CALL: "AI call",
};

const PHASE_ORDER_INDEX = new Map<string, number>(
  [...GENERATION_PHASES, ...LEGACY_GENERATION_PHASES, "done"].map((p, i) => [p, i])
);

export function phaseLabel(phase: string): string {
  return PHASE_LABELS[phase] ?? phase;
}

export function phaseDescription(phase: string): string {
  return PHASE_DESCRIPTIONS[phase] ?? "";
}

export function callLabel(label: string): string {
  return CALL_LABELS[label] ?? label.replace(/_/g, " ").toLowerCase();
}

export function sortPhases(phases: Iterable<string>): string[] {
  return [...new Set(phases)].sort((a, b) => {
    const ia = PHASE_ORDER_INDEX.get(a) ?? 1000;
    const ib = PHASE_ORDER_INDEX.get(b) ?? 1000;
    if (ia !== ib) return ia - ib;
    return a.localeCompare(b);
  });
}

export function formatMs(ms: unknown): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export type LlmRequest = {
  model?: string;
  temperature?: number;
  messages?: Array<{ role: string; content: string }>;
  response_format?: unknown;
};

export type LlmCallEntry = {
  kind: "llm_call";
  callId: string;
  label: string;
  model: string;
  state: "waiting" | "done" | "error";
  ms?: number;
  detail?: string;
  request?: LlmRequest;
  response?: unknown;
  raw?: string;
  error?: string;
};

export type TextLogEntry = {
  kind: "text";
  text: string;
};

export type LogEntry = TextLogEntry | LlmCallEntry;

/** True for banner lines that only restate the phase (redundant next to the UI header). */
export function isPhaseBannerEvent(event: StreamEvent): boolean {
  if (event.type === "phase") return true;
  return event.type === "step" && event.kind === "phase_start";
}

function isLlmStatus(state: string): boolean {
  return state === "waiting_llm" || state === "llm_done" || state === "llm_error";
}

function normalizeRequest(value: unknown): LlmRequest | undefined {
  if (!value || typeof value !== "object") return undefined;
  const r = value as Record<string, unknown>;
  const messages = Array.isArray(r.messages)
    ? r.messages
        .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
        .map((m) => ({
          role: String(m.role ?? ""),
          content: String(m.content ?? ""),
        }))
    : undefined;
  return {
    model: typeof r.model === "string" ? r.model : undefined,
    temperature: typeof r.temperature === "number" ? r.temperature : undefined,
    messages,
    response_format: r.response_format,
  };
}

export function formatLlmCallTitle(entry: LlmCallEntry): string {
  const label = callLabel(entry.label);
  const model = entry.model;
  const dur = formatMs(entry.ms);
  if (entry.state === "waiting") {
    return `⏳ waiting on LLM (${label}${model ? `, ${model}` : ""})…`;
  }
  if (entry.state === "error") {
    return `✗ LLM error — ${label}${dur ? ` after ${dur}` : ""}${
      entry.detail ? `: ${entry.detail}` : ""
    }`;
  }
  return `✓ LLM done — ${label}${dur ? ` in ${dur}` : ""}${model ? ` [${model}]` : ""}`;
}

function findPriorRequest(
  entries: LogEntry[],
  callId: string | null,
  label: string
): LlmRequest | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.kind !== "llm_call" || !e.request) continue;
    if (callId && e.callId === callId) return e.request;
    if (!callId && e.label === label) return e.request;
  }
  return undefined;
}

/** Append an LLM status row. Waiting and done stay as separate entries. */
function appendLlmCall(entries: LogEntry[], event: StreamEvent): LogEntry[] {
  const state = String(event.state || "");
  if (state !== "waiting_llm" && state !== "llm_done" && state !== "llm_error") {
    return entries;
  }

  const label = typeof event.label === "string" ? event.label : "LLM_CALL";
  const model = typeof event.model === "string" ? event.model : "";
  const explicitId = typeof event.call_id === "string" ? event.call_id : null;
  const request =
    normalizeRequest(event.request) ?? findPriorRequest(entries, explicitId, label);
  const hasResponse = Object.prototype.hasOwnProperty.call(event, "response");
  const hasRaw = typeof event.raw === "string";
  const hasError = typeof event.error === "string";
  const ms = typeof event.ms === "number" ? event.ms : undefined;
  const detail = typeof event.detail === "string" ? event.detail : undefined;
  const callId =
    explicitId ??
    `${state === "waiting_llm" ? "pending" : state === "llm_done" ? "done" : "err"}-${entries.length}`;

  const entry: LlmCallEntry = {
    kind: "llm_call",
    callId,
    label,
    model,
    state: state === "waiting_llm" ? "waiting" : state === "llm_done" ? "done" : "error",
    ms,
    detail,
    request,
    response: hasResponse ? event.response : undefined,
    raw: hasRaw ? String(event.raw) : undefined,
    error: hasError ? String(event.error) : state === "llm_error" ? detail : undefined,
  };

  return [...entries, entry];
}

/** Apply one stream event onto a phase's structured log entries. */
export function applyStreamEventToEntries(
  entries: LogEntry[],
  event: StreamEvent,
  options?: { omitPhaseBanners?: boolean }
): LogEntry[] {
  if (options?.omitPhaseBanners && isPhaseBannerEvent(event)) {
    return entries;
  }

  if (event.type === "status" && typeof event.state === "string" && isLlmStatus(event.state)) {
    return appendLlmCall(entries, event);
  }

  const line = formatStreamEvent(event);
  if (line === null) return entries;
  return [...entries, { kind: "text", text: line }];
}

/** Convert a stream event to the same log line shown during live generation. */
export function formatStreamEvent(event: StreamEvent): string | null {
  if (event.type === "phase" && typeof event.name === "string") {
    const blurb = phaseDescription(event.name);
    return blurb ? `▶ ${phaseLabel(event.name)} — ${blurb}` : `▶ ${phaseLabel(event.name)}`;
  }
  if (event.type === "step") {
    const label = typeof event.label === "string" ? event.label : "step";
    const detail = typeof event.detail === "string" ? event.detail : "";
    if (event.kind === "phase_start") {
      // Prefer the canonical blurb so old stream logs stay readable.
      const blurb = phaseDescription(label) || detail;
      return blurb ? `→ ${blurb}` : `→ starting ${phaseLabel(label)}`;
    }
    return detail ? `· ${detail}` : `· ${callLabel(label)}`;
  }
  if (event.type === "status") {
    const state = typeof event.state === "string" ? event.state : "";
    const label =
      typeof event.label === "string" ? callLabel(event.label) : "call";
    const model = typeof event.model === "string" ? event.model : "";
    const detail = typeof event.detail === "string" ? event.detail : "";
    const dur = formatMs(event.ms);
    if (state === "waiting_llm") {
      return `⏳ waiting on LLM (${label}${model ? `, ${model}` : ""})…`;
    }
    if (state === "waiting_embed") {
      return `⏳ waiting on embeddings (${model || "voyage"})…${detail ? ` ${detail}` : ""}`;
    }
    if (state === "llm_done") {
      return `✓ LLM done — ${label}${dur ? ` in ${dur}` : ""}${model ? ` [${model}]` : ""}`;
    }
    if (state === "embed_done") {
      return `✓ embeddings done${dur ? ` in ${dur}` : ""}${detail ? ` — ${detail}` : ""}`;
    }
    if (state === "llm_error") {
      return `✗ LLM error — ${label}${dur ? ` after ${dur}` : ""}${detail ? `: ${detail}` : ""}`;
    }
    return detail || `status: ${state}`;
  }
  if (event.type === "done") return "✓ done";
  if (event.type === "stopped") return "■ stopped — can resume";
  if (event.type === "failed") {
    const msg = typeof event.message === "string" ? event.message : "";
    return msg ? `✗ failed — ${msg}` : "✗ failed";
  }
  if (event.type === "resumed") return "▶ resumed";
  if (event.type === "error") {
    const msg = typeof event.message === "string" ? event.message : JSON.stringify(event);
    return `✗ error: ${msg}`;
  }
  if (event.type === "seed" && typeof event.name === "string") {
    const kind = typeof event.node_type === "string" ? event.node_type : "concept";
    return `seed: ${event.name} (${kind})`;
  }
  if (
    event.type === "node" &&
    typeof event.ref === "string" &&
    typeof event.name === "string"
  ) {
    const seed = event.is_seed ? " [seed]" : "";
    return `node: ${event.ref} (${event.name})${seed}`;
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
  if (event.type === "expand_stats" && typeof event.node_count === "number") {
    const edges =
      typeof event.prereq_edges === "number" ? event.prereq_edges : "?";
    return `expand: ${event.node_count} nodes, ${edges} prereq edges`;
  }
  if (event.type === "edge_coverage") {
    const uncovered = Array.isArray(event.uncovered) ? event.uncovered.length : 0;
    const count = typeof event.edge_count === "number" ? event.edge_count : "?";
    return `edge coverage: ${count} edges, ${uncovered} still unlinked`;
  }
  if (event.type === "prune_unlinked" && Array.isArray(event.removed)) {
    return `prune: removed ${event.removed.length} unlinked concept(s)`;
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
  // Hide noisy unknown internals; still show something useful if detail exists.
  if (typeof event.detail === "string") return `· ${event.detail}`;
  return null;
}

export type PhaseLogGroup = {
  phase: string;
  entries: LogEntry[];
  /** Summary lines (for counts / older callers). */
  lines: string[];
};

function entrySummary(entry: LogEntry): string {
  return entry.kind === "llm_call" ? formatLlmCallTitle(entry) : entry.text;
}

export function groupStreamEventsByPhase(
  events: StreamEvent[],
  options?: { omitPhaseBanners?: boolean }
): PhaseLogGroup[] {
  const omitBanners = options?.omitPhaseBanners ?? false;
  const groups: PhaseLogGroup[] = [];
  let current: PhaseLogGroup | null = null;

  for (const event of events) {
    if (event.type === "phase" && typeof event.name === "string") {
      current = { phase: event.name, entries: [], lines: [] };
      groups.push(current);
      if (omitBanners) continue;
    }
    if (!current) {
      current = { phase: "0_scope", entries: [], lines: [] };
      groups.push(current);
    }
    current.entries = applyStreamEventToEntries(current.entries, event, {
      omitPhaseBanners: omitBanners,
    });
  }
  for (const g of groups) {
    g.lines = g.entries.map(entrySummary);
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
