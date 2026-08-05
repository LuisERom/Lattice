export type StreamEvent = { type: string; [k: string]: unknown };

/** Current Doc 4 pipeline phase ids (checkpoint filenames). */
export const GENERATION_PHASES = [
  "0_scope",
  "A_scaffold",
  "B_seeds",
  "C_expand",
  "D_detailed",
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

function upsertLlmCall(entries: LogEntry[], event: StreamEvent): LogEntry[] {
  const state = String(event.state || "");
  const label = typeof event.label === "string" ? event.label : "LLM_CALL";
  const model = typeof event.model === "string" ? event.model : "";
  const explicitId = typeof event.call_id === "string" ? event.call_id : null;
  const request = normalizeRequest(event.request);
  const hasResponse = Object.prototype.hasOwnProperty.call(event, "response");
  const hasRaw = typeof event.raw === "string";
  const hasError = typeof event.error === "string";
  const ms = typeof event.ms === "number" ? event.ms : undefined;
  const detail = typeof event.detail === "string" ? event.detail : undefined;
  const next = [...entries];

  if (state === "waiting_llm") {
    const callId = explicitId ?? `pending-${next.length}`;
    const idx = explicitId
      ? next.findIndex((e) => e.kind === "llm_call" && e.callId === explicitId)
      : -1;
    const entry: LlmCallEntry = {
      kind: "llm_call",
      callId,
      label,
      model,
      state: "waiting",
      detail,
      request,
    };
    if (idx >= 0) {
      const prev = next[idx] as LlmCallEntry;
      next[idx] = { ...prev, ...entry, request: request ?? prev.request };
      return next;
    }
    next.push(entry);
    return next;
  }

  if (state === "llm_done" || state === "llm_error") {
    let idx = explicitId
      ? next.findIndex((e) => e.kind === "llm_call" && e.callId === explicitId)
      : -1;
    if (idx < 0) {
      for (let i = next.length - 1; i >= 0; i--) {
        const e = next[i];
        if (e.kind === "llm_call" && e.state === "waiting" && e.label === label) {
          idx = i;
          break;
        }
      }
    }
    const prev: LlmCallEntry | null =
      idx >= 0 && next[idx]?.kind === "llm_call" ? (next[idx] as LlmCallEntry) : null;
    const callId =
      explicitId ?? prev?.callId ?? `${state === "llm_done" ? "done" : "err"}-${next.length}`;
    const entry: LlmCallEntry = {
      kind: "llm_call",
      callId,
      label,
      model: model || prev?.model || "",
      state: state === "llm_done" ? "done" : "error",
      ms,
      detail,
      request: request ?? prev?.request,
      response: hasResponse ? event.response : prev?.response,
      raw: hasRaw ? String(event.raw) : prev?.raw,
      error: hasError ? String(event.error) : state === "llm_error" ? detail : prev?.error,
    };
    if (idx >= 0) {
      next[idx] = entry;
      return next;
    }
    next.push(entry);
    return next;
  }

  return next;
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
    return upsertLlmCall(entries, event);
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
