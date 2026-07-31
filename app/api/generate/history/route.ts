import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { type NextRequest } from "next/server";
import {
  type ApiCallDetailResponse,
  GENERATION_PHASES,
  type GenerationPhaseOutline,
  type GenerationRunSummary,
  type PhaseDetailResponse,
  type RunOutlineResponse,
  summarizePhaseOutcome,
} from "@/lib/generate/history";
import {
  PHASE_DESCRIPTIONS,
  buildPhaseTimeline,
  pairApiCalls,
  parseStreamNdjson,
  type PairedApiCall,
  type StreamEvent,
} from "@/lib/generate/stream-log";
import { artifactsDir, generatedTopicPath } from "@/lib/paths";

export type { GenerationRunSummary };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PHASE_SET = new Set<string>(GENERATION_PHASES);

function artifactsRoot(): string {
  return artifactsDir();
}

function safeSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug);
}

function readJsonSafe<T>(filePath: string): T | null {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function slugTimestamp(slug: string): number | null {
  const match = slug.match(/-(\d{10,})$/);
  if (!match) return null;
  const ts = Number(match[1]);
  return Number.isFinite(ts) ? ts : null;
}

type ScopeFile = {
  scope?: {
    name?: string;
    scope_level?: string;
    scope_description?: string;
    summary?: string;
  };
};

type RunSummaryOptions = {
  fullStream: boolean;
  providedEvents?: StreamEvent[];
};

function readTailEvents(streamPath: string, maxBytes = 16_384): StreamEvent[] {
  if (!existsSync(streamPath)) return [];
  const size = statSync(streamPath).size;
  if (size <= 0) return [];
  const start = Math.max(0, size - maxBytes);
  const length = size - start;
  if (length <= 0) return [];

  const fd = openSync(streamPath, "r");
  try {
    const buf = Buffer.alloc(length);
    const bytesRead = readSync(fd, buf, 0, length, start);
    let raw = buf.toString("utf8", 0, bytesRead);
    if (start > 0) {
      const newlineIdx = raw.indexOf("\n");
      raw = newlineIdx >= 0 ? raw.slice(newlineIdx + 1) : "";
    }
    return parseStreamNdjson(raw);
  } finally {
    closeSync(fd);
  }
}

function readStreamEvents(streamPath: string): StreamEvent[] {
  if (!existsSync(streamPath)) return [];
  return parseStreamNdjson(readFileSync(streamPath, "utf8"));
}

function deriveStatus(
  phasesCompleted: string[],
  hasDone: boolean,
  hasError: boolean
): GenerationRunSummary["status"] {
  if (hasError) return "failed";
  if (hasDone || phasesCompleted.includes("H_audit")) return "completed";
  return "in_progress";
}

function summarizeRun(
  slug: string,
  dirPath: string,
  options: RunSummaryOptions
): GenerationRunSummary | null {
  const scopeData = readJsonSafe<ScopeFile>(path.join(dirPath, "0_scope.json"));
  const name = scopeData?.scope?.name?.trim() || slug;

  const phasesCompleted = GENERATION_PHASES.filter((phase) =>
    existsSync(path.join(dirPath, `${phase}.json`))
  );

  const streamPath = path.join(dirPath, "stream.ndjson");
  let eventCount: number | null = null;
  let lastPhase: string | null = phasesCompleted.at(-1) ?? null;
  let hasDone = false;
  let hasError = false;

  if (existsSync(streamPath)) {
    const events =
      options.providedEvents ??
      (options.fullStream ? readStreamEvents(streamPath) : readTailEvents(streamPath));
    if (options.fullStream) {
      eventCount = events.length;
    }
    for (const event of events) {
      if (event.type === "phase" && typeof event.name === "string") {
        lastPhase = event.name;
      }
      if (event.type === "done") hasDone = true;
      if (event.type === "error") hasError = true;
    }
  }

  const ts = slugTimestamp(slug);
  const dirStat = statSync(dirPath);
  const importPath = generatedTopicPath(slug);

  return {
    slug,
    name,
    scopeLevel: scopeData?.scope?.scope_level || "deep",
    scopeDescription: scopeData?.scope?.scope_description || "",
    status: deriveStatus(phasesCompleted, hasDone, hasError),
    phasesCompleted,
    lastPhase,
    startedAt: ts ? new Date(ts).toISOString() : null,
    updatedAt: dirStat.mtime.toISOString(),
    eventCount,
    hasImport: existsSync(importPath),
  };
}

function listRuns(): GenerationRunSummary[] {
  const root = artifactsRoot();
  if (!existsSync(root)) return [];

  const runs: GenerationRunSummary[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !safeSlug(entry.name)) continue;
    const summary = summarizeRun(entry.name, path.join(root, entry.name), { fullStream: false });
    if (summary) runs.push(summary);
  }

  runs.sort((a, b) => {
    const aTs = a.startedAt ? Date.parse(a.startedAt) : Date.parse(a.updatedAt);
    const bTs = b.startedAt ? Date.parse(b.startedAt) : Date.parse(b.updatedAt);
    return bTs - aTs;
  });
  return runs.slice(0, 20);
}

type LoadedRun = {
  slug: string;
  dirPath: string;
  summary: GenerationRunSummary;
  events: StreamEvent[];
};

function loadRun(slug: string): LoadedRun | null {
  if (!safeSlug(slug)) return null;
  const dirPath = path.join(artifactsRoot(), slug);
  if (!existsSync(dirPath)) return null;

  const streamPath = path.join(dirPath, "stream.ndjson");
  const events = readStreamEvents(streamPath);
  const summary = summarizeRun(slug, dirPath, { fullStream: true, providedEvents: events });
  if (!summary) return null;
  return { slug, dirPath, summary, events };
}

function readPhaseCheckpoint(runDir: string, phase: string): unknown {
  return readJsonSafe(path.join(runDir, `${phase}.json`));
}

function buildRunOutline(run: LoadedRun): RunOutlineResponse {
  const calls = pairApiCalls(run.events);
  const phases: GenerationPhaseOutline[] = GENERATION_PHASES.map((phase) => {
    const apiCallCount = calls.filter((call) => call.phase === phase).length;
    const phasePayload = readPhaseCheckpoint(run.dirPath, phase);
    return {
      phase,
      description: PHASE_DESCRIPTIONS[phase] || "",
      completed: run.summary.phasesCompleted.includes(phase),
      apiCallCount,
      outcome: summarizePhaseOutcome(phase, phasePayload),
    };
  });
  return { summary: run.summary, phases };
}

function buildPhaseDetail(run: LoadedRun, phase: string): PhaseDetailResponse {
  const phasePayload = readPhaseCheckpoint(run.dirPath, phase);
  return {
    summary: run.summary,
    phase,
    description: PHASE_DESCRIPTIONS[phase] || "",
    completed: run.summary.phasesCompleted.includes(phase),
    outcome: summarizePhaseOutcome(phase, phasePayload),
    timeline: buildPhaseTimeline(run.events, phase),
  };
}

function findApiCall(run: LoadedRun, phase: string, callId: string): PairedApiCall | null {
  const calls = pairApiCalls(run.events).filter((call) => call.phase === phase);
  for (const call of calls) {
    if (call.id === callId || call.callId === callId) return call;
  }
  return null;
}

function callDetailResponse(
  run: LoadedRun,
  phase: string,
  call: PairedApiCall
): ApiCallDetailResponse {
  const doneOrError = call.errorEvent || call.doneEvent;
  const startMessages = Array.isArray(call.startEvent?.messages)
    ? call.startEvent.messages
    : [];
  const requestMessages = startMessages.map((msg) => ({
    role: typeof msg.role === "string" ? msg.role : "unknown",
    content: typeof msg.content === "string" ? msg.content : "",
  }));
  const errorMessage =
    doneOrError && typeof doneOrError.message === "string"
      ? doneOrError.message
      : null;

  return {
    summary: run.summary,
    phase,
    call: {
      callId: call.id,
      label: call.label,
      model: call.model,
      status: call.status,
      elapsedMs:
        doneOrError && typeof doneOrError.elapsed_ms === "number"
          ? doneOrError.elapsed_ms
          : null,
      legacy: call.legacy,
      requestMessages,
      response: doneOrError?.response,
      responseStored: doneOrError?.response !== undefined,
      errorMessage,
    },
  };
}

function isValidPhase(phase: string): boolean {
  return PHASE_SET.has(phase);
}

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug");
  if (!slug) {
    return Response.json({ runs: listRuns() });
  }

  const phase = req.nextUrl.searchParams.get("phase");
  const call = req.nextUrl.searchParams.get("call");

  if (phase && !isValidPhase(phase)) {
    return Response.json({ error: "Invalid phase" }, { status: 400 });
  }
  if (call && !phase) {
    return Response.json({ error: "phase query param is required when call is provided" }, { status: 400 });
  }

  const run = loadRun(slug);
  if (!run) {
    return Response.json({ error: "Run not found" }, { status: 404 });
  }

  if (!phase) {
    return Response.json(buildRunOutline(run));
  }

  if (!call) {
    return Response.json(buildPhaseDetail(run, phase));
  }

  const apiCall = findApiCall(run, phase, call);
  if (!apiCall) {
    return Response.json({ error: "API call not found" }, { status: 404 });
  }
  return Response.json(callDetailResponse(run, phase, apiCall));
}
