import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { type NextRequest } from "next/server";
import type { GenerationRunSummary } from "@/lib/generate/history";
import {
  GENERATION_PHASES,
  groupStreamEventsByPhase,
  parseStreamNdjson,
  type PhaseLogGroup,
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

function summarizeRun(slug: string, dirPath: string): GenerationRunSummary | null {
  const scopeData = readJsonSafe<ScopeFile>(path.join(dirPath, "0_scope.json"));
  const name = scopeData?.scope?.name?.trim() || slug;

  const phasesCompleted = GENERATION_PHASES.filter((phase) =>
    existsSync(path.join(dirPath, `${phase}.json`))
  );

  const streamPath = path.join(dirPath, "stream.ndjson");
  let eventCount = 0;
  let status: GenerationRunSummary["status"] = "in_progress";
  let lastPhase: string | null = phasesCompleted.at(-1) ?? null;

  if (existsSync(streamPath)) {
    const raw = readFileSync(streamPath, "utf8");
    const events = parseStreamNdjson(raw);
    eventCount = events.length;
    for (const event of events) {
      if (event.type === "phase" && typeof event.name === "string") {
        lastPhase = event.name;
      }
    }
    const hasDone = events.some((e) => e.type === "done");
    const hasError = events.some((e) => e.type === "error");
    if (hasDone && phasesCompleted.includes("H_audit")) {
      status = "completed";
    } else if (hasError || (phasesCompleted.length > 0 && !hasDone)) {
      status = "failed";
    } else if (hasDone) {
      status = "completed";
    }
  } else if (phasesCompleted.includes("H_audit")) {
    status = "completed";
  } else if (phasesCompleted.length > 0) {
    status = "failed";
  }

  const ts = slugTimestamp(slug);
  const dirStat = statSync(dirPath);
  const importPath = generatedTopicPath(slug);

  return {
    slug,
    name,
    scopeLevel: scopeData?.scope?.scope_level || "deep",
    scopeDescription: scopeData?.scope?.scope_description || "",
    status,
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
    const summary = summarizeRun(entry.name, path.join(root, entry.name));
    if (summary) runs.push(summary);
  }

  runs.sort((a, b) => {
    const aTs = a.startedAt ? Date.parse(a.startedAt) : Date.parse(a.updatedAt);
    const bTs = b.startedAt ? Date.parse(b.startedAt) : Date.parse(b.updatedAt);
    return bTs - aTs;
  });
  return runs.slice(0, 20);
}

function loadRunDetail(slug: string): {
  summary: GenerationRunSummary;
  phases: PhaseLogGroup[];
} | null {
  if (!safeSlug(slug)) return null;
  const dirPath = path.join(artifactsRoot(), slug);
  if (!existsSync(dirPath)) return null;

  const summary = summarizeRun(slug, dirPath);
  if (!summary) return null;

  const streamPath = path.join(dirPath, "stream.ndjson");
  if (!existsSync(streamPath)) {
    return { summary, phases: [] };
  }

  const events = parseStreamNdjson(readFileSync(streamPath, "utf8"));
  const phases = groupStreamEventsByPhase(events).filter((g) => PHASE_SET.has(g.phase));
  return { summary, phases };
}

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug");
  if (slug) {
    const detail = loadRunDetail(slug);
    if (!detail) {
      return Response.json({ error: "Run not found" }, { status: 404 });
    }
    return Response.json(detail);
  }
  return Response.json({ runs: listRuns() });
}
