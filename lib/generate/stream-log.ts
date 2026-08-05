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

export const PHASE_LABELS: Record<string, string> = {
  "0_scope": "0_scope · scope",
  A_scaffold: "A_scaffold · goal areas",
  B_seeds: "B_seeds · learning goals",
  C_expand: "C_expand · prereq expansion",
  D_detailed: "D_detailed · node detail",
  E_edges: "E_edges · lateral edges",
  F_procedures: "F_procedures · compositions",
  G_items: "G_items · questions",
  H_audit: "H_audit · audit",
  B_concepts: "B_concepts · (legacy enumerate)",
  C_nodes: "C_nodes · (legacy dedup)",
  done: "done",
};

/** Human labels for LLM/embed call tags. */
export const CALL_LABELS: Record<string, string> = {
  SCOPE_INTERVIEW: "scope interview turn",
  PHASE_A_SCAFFOLD: "drafting section scaffold",
  PHASE_A_CRITIC: "scaffold gap critic",
  PHASE_B_SEEDS: "proposing section seeds",
  PHASE_B_SEED_CRITIC: "seed gap critic",
  PHASE_B_ENUMERATE: "enumerating concepts (legacy)",
  PHASE_B_GAP_CRITIC: "enumeration critic (legacy)",
  PHASE_C_EXPAND: "asking prerequisites for a node",
  PHASE_C_ADJUDICATE: "dedup adjudication (legacy)",
  PHASE_D_DETAIL: "detailing node descriptions",
  PHASE_D_AUDITOR: "auditing node quality",
  PHASE_E_SECTION: "proposing section-local edges",
  PHASE_E_NODE: "proposing cross-section edges",
  PHASE_E_CRITIC: "edge critic (missing/wrong links)",
  PHASE_E_COVERAGE: "covering unlinked nodes",
  PHASE_F_PROCEDURE: "picking procedure members",
  PHASE_G_ITEM: "writing item questions",
  PHASE_H_CRITIC: "completeness critic",
  EMBEDDINGS: "computing embeddings",
  LLM_CALL: "LLM call",
};

const PHASE_ORDER_INDEX = new Map<string, number>(
  [...GENERATION_PHASES, ...LEGACY_GENERATION_PHASES, "done"].map((p, i) => [p, i])
);

export function phaseLabel(phase: string): string {
  return PHASE_LABELS[phase] ?? phase;
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

function formatMs(ms: unknown): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Convert a stream event to the same log line shown during live generation. */
export function formatStreamEvent(event: StreamEvent): string | null {
  if (event.type === "phase" && typeof event.name === "string") {
    return `▶ phase: ${phaseLabel(event.name)}`;
  }
  if (event.type === "step") {
    const label = typeof event.label === "string" ? event.label : "step";
    const detail = typeof event.detail === "string" ? event.detail : "";
    if (event.kind === "phase_start") {
      return detail
        ? `→ starting ${phaseLabel(label)} — ${detail}`
        : `→ starting ${phaseLabel(label)}`;
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
