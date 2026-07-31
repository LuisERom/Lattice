import { GENERATION_PHASES, type PhaseTimelineRow } from "./stream-log";

export type GenerationRunSummary = {
  slug: string;
  name: string;
  scopeLevel: string;
  scopeDescription: string;
  status: "completed" | "failed" | "in_progress";
  phasesCompleted: string[];
  lastPhase: string | null;
  startedAt: string | null;
  updatedAt: string;
  eventCount: number | null;
  hasImport: boolean;
};

export type OutcomeSection = {
  title: string;
  lines: string[];
};

export type GenerationPhaseOutline = {
  phase: string;
  description: string;
  completed: boolean;
  apiCallCount: number;
  outcome: OutcomeSection[];
};

export type RunOutlineResponse = {
  summary: GenerationRunSummary;
  phases: GenerationPhaseOutline[];
};

export type PhaseDetailResponse = {
  summary: GenerationRunSummary;
  phase: string;
  description: string;
  completed: boolean;
  outcome: OutcomeSection[];
  timeline: PhaseTimelineRow[];
};

export type ApiCallDetailResponse = {
  summary: GenerationRunSummary;
  phase: string;
  call: {
    callId: string;
    label: string;
    model: string;
    status: "running" | "done" | "error";
    elapsedMs: number | null;
    legacy: boolean;
    requestMessages: Array<{ role: string; content: string }>;
    response: unknown;
    responseStored: boolean;
    errorMessage: string | null;
  };
};

type JsonObject = Record<string, unknown>;

function numberCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function objectNameList(values: unknown, max = 20): string[] {
  if (!Array.isArray(values)) return [];
  const names = values
    .map((row) =>
      row &&
      typeof row === "object" &&
      typeof (row as { name?: unknown }).name === "string"
        ? String((row as { name: string }).name)
        : null
    )
    .filter((name): name is string => !!name);
  if (names.length <= max) return names;
  return [...names.slice(0, max), `+${names.length - max} more`];
}

function pushCount(lines: string[], label: string, value: unknown): void {
  if (Array.isArray(value)) {
    lines.push(`${label}: ${value.length}`);
  }
}

function countByKind(rows: unknown): Record<string, number> {
  const counts: Record<string, number> = {};
  if (!Array.isArray(rows)) return counts;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const kind = (row as { kind?: unknown }).kind;
    if (typeof kind !== "string") continue;
    counts[kind] = (counts[kind] || 0) + 1;
  }
  return counts;
}

function summarizeScope(payload: JsonObject): OutcomeSection[] {
  const scope = payload.scope as JsonObject | undefined;
  const outline = payload.outline;
  const lines: string[] = [];
  if (scope) {
    const name = typeof scope.name === "string" ? scope.name : "unknown";
    const level = typeof scope.scope_level === "string" ? scope.scope_level : "deep";
    lines.push(`Name: ${name}`);
    lines.push(`Level: ${level}`);
    if (typeof scope.summary === "string" && scope.summary) lines.push(`Summary: ${scope.summary}`);
  }
  if (Array.isArray(outline)) {
    lines.push(`Outline sections: ${outline.length}`);
    const outlineNames = objectNameList(
      outline.map((row) =>
        row && typeof row === "object"
          ? { name: (row as { section?: unknown }).section }
          : null
      )
    );
    if (outlineNames.length > 0) {
      lines.push(`Sections: ${outlineNames.join(", ")}`);
    }
  }
  return [{ title: "Scope output", lines }];
}

export function summarizePhaseOutcome(phase: string, rawPayload: unknown): OutcomeSection[] {
  if (!rawPayload || typeof rawPayload !== "object") {
    return [{ title: "Checkpoint output", lines: ["No checkpoint payload saved for this phase."] }];
  }
  const payload = rawPayload as JsonObject;

  if (phase === "0_scope") return summarizeScope(payload);

  if (phase === "A_scaffold") {
    const sections = payload.sections;
    const lines = [`Sections: ${numberCount(sections)}`];
    const names = objectNameList(sections);
    if (names.length > 0) lines.push(`Section names: ${names.join(", ")}`);
    return [{ title: "Scaffold output", lines }];
  }

  if (phase === "B_concepts") {
    return [{ title: "Enumeration output", lines: [`Candidates: ${numberCount(payload.candidates)}`] }];
  }

  if (phase === "C_nodes") {
    return [{ title: "Canonical nodes", lines: [`Nodes: ${numberCount(payload.nodes)}`] }];
  }

  if (phase === "D_detailed") {
    return [
      {
        title: "Detailed nodes",
        lines: [`Nodes: ${numberCount(payload.nodes)}`, `Flags: ${numberCount(payload.flags)}`],
      },
    ];
  }

  if (phase === "D2_ground") {
    return [
      {
        title: "Grounding output",
        lines: [
          `Nodes: ${numberCount(payload.nodes)}`,
          `Sources: ${numberCount(payload.sources)}`,
          `Node-source links: ${numberCount(payload.node_sources)}`,
          `Grounding flags: ${numberCount(payload.grounding_flags)}`,
        ],
      },
    ];
  }

  if (phase === "E_edges") {
    return [{ title: "Graph links", lines: [`Edges: ${numberCount(payload.edges)}`] }];
  }

  if (phase === "F_procedures") {
    const procMembers = payload.procedure_members;
    const lines = [`Edges: ${numberCount(payload.edges)}`];
    if (procMembers && typeof procMembers === "object") {
      lines.push(`Procedures with ordered members: ${Object.keys(procMembers).length}`);
    }
    return [{ title: "Procedure structure", lines }];
  }

  if (phase === "G_items") {
    const items = payload.items;
    const lines = [`Items: ${numberCount(items)}`];
    const byKind = countByKind(items);
    for (const [kind, count] of Object.entries(byKind)) {
      lines.push(`${kind}: ${count}`);
    }
    return [{ title: "Assessment items", lines }];
  }

  if (phase === "H_audit") {
    const lines: string[] = [];
    pushCount(lines, "Errors", payload.errors);
    pushCount(lines, "Detail flags", payload.detail_flags);
    pushCount(lines, "Grounding flags", payload.grounding_flags);
    pushCount(lines, "Completeness flags", payload.completeness_flags);
    if (lines.length === 0) lines.push("Audit payload captured.");
    return [{ title: "Audit results", lines }];
  }

  const keys = Object.keys(payload);
  return [{ title: "Checkpoint output", lines: [`Keys: ${keys.join(", ") || "none"}`] }];
}

export { GENERATION_PHASES };
