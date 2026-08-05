"use client";

import { useEffect, useState } from "react";
import type { GenerationRunSummary } from "@/lib/generate/history";
import type { LogEntry, PhaseLogGroup } from "@/lib/generate/stream-log";
import {
  GENERATION_PHASES,
  phaseDescription,
  phaseLabel,
  sortPhases,
} from "@/lib/generate/stream-log";
import EventLogEntries from "./EventLogEntries";

type RunDetail = {
  summary: GenerationRunSummary;
  phases: PhaseLogGroup[];
};

function statusLabel(status: GenerationRunSummary["status"]): string {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "in progress";
}

function statusClass(status: GenerationRunSummary["status"]): string {
  if (status === "completed") return "text-emerald-400";
  if (status === "failed") return "text-rose-400";
  return "text-amber-300";
}

function formatWhen(iso: string | null): string {
  if (!iso) return "unknown time";
  return new Date(iso).toLocaleString();
}

function RunCard({
  summary,
  expanded,
  onToggle,
}: {
  summary: GenerationRunSummary;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [openPhases, setOpenPhases] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!expanded || detail) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(`/api/generate/history?slug=${encodeURIComponent(summary.slug)}`)
      .then(async (resp) => {
        const data = (await resp.json()) as RunDetail & { error?: string };
        if (!resp.ok) throw new Error(data.error || "Failed to load run details");
        if (!cancelled) setDetail(data);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [expanded, detail, summary.slug]);

  const phaseMap = new Map(
    (detail?.phases || []).map((p) => [p.phase, p.entries ?? []] as const)
  );

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--background)]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--surface-2)]"
      >
        <span className="text-[var(--muted)]">{expanded ? "▼" : "▶"}</span>
        <span className="font-medium text-[var(--text)]">{summary.name}</span>
        <span className="font-mono text-xs text-[var(--muted)]">{summary.slug}</span>
        <span className={`ml-auto text-xs ${statusClass(summary.status)}`}>
          {statusLabel(summary.status)}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">
          <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
            <span>Depth: {summary.scopeLevel}</span>
            <span>Started: {formatWhen(summary.startedAt)}</span>
            <span>Updated: {formatWhen(summary.updatedAt)}</span>
            <span>{summary.eventCount} log events</span>
            {summary.hasImport && <span className="text-emerald-400">imported</span>}
            {summary.lastPhase && (
              <span>Reached: {phaseLabel(summary.lastPhase)}</span>
            )}
          </div>
          {summary.scopeDescription && (
            <p className="mb-2 text-[var(--text)]">
              <span className="text-[var(--muted)]">Topic: </span>
              {summary.scopeDescription}
            </p>
          )}

          {loading && <div>Loading phase details...</div>}
          {error && <div className="text-rose-300">{error}</div>}

          {!loading && !error && detail && (
            <div className="space-y-2">
              {sortPhases([
                ...GENERATION_PHASES,
                ...summary.phasesCompleted,
                ...detail.phases.map((p) => p.phase),
              ]).map((phase) => {
                const entries: LogEntry[] = phaseMap.get(phase) || [];
                const completed = summary.phasesCompleted.includes(phase);
                const isOpen = !!openPhases[phase];
                return (
                  <div
                    key={phase}
                    className="rounded border border-[var(--border)] bg-[var(--surface)]"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setOpenPhases((prev) => ({ ...prev, [phase]: !prev[phase] }))
                      }
                      className="flex w-full items-start gap-2 px-2 py-1.5 text-left hover:bg-[var(--surface-2)]"
                    >
                      <span className="mt-0.5 text-[var(--muted)]">{isOpen ? "▼" : "▶"}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="font-medium text-sky-300">{phaseLabel(phase)}</span>
                          {completed && (
                            <span className="text-emerald-400">saved</span>
                          )}
                          <span className="text-[var(--muted)]">
                            {entries.length > 0
                              ? `${entries.length} steps`
                              : completed
                                ? "no detailed log"
                                : "not started"}
                          </span>
                        </span>
                        {phaseDescription(phase) && (
                          <span className="mt-0.5 block leading-snug text-[var(--text)]/80">
                            {phaseDescription(phase)}
                          </span>
                        )}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="max-h-96 overflow-y-auto border-t border-[var(--border)] p-2 font-mono text-[10px] leading-relaxed">
                        {entries.length === 0 && completed && (
                          <div className="mb-1 text-[var(--muted)]">
                            Checkpoint saved — no stream events recorded for this phase.
                          </div>
                        )}
                        <EventLogEntries entries={entries} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function GenerationHistory() {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<GenerationRunSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch("/api/generate/history")
      .then(async (resp) => {
        const data = (await resp.json()) as { runs?: GenerationRunSummary[]; error?: string };
        if (!resp.ok) throw new Error(data.error || "Failed to load history");
        if (!cancelled) setRuns(data.runs || []);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        <span className="text-[var(--muted)]">{open ? "▼" : "▶"}</span>
        <span className="text-sm text-[var(--muted)]">Generation history</span>
        {runs.length > 0 && (
          <span className="text-xs text-[var(--muted)]">({runs.length} runs)</span>
        )}
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          {loading && <div className="text-sm text-[var(--muted)]">Loading history...</div>}
          {error && <div className="text-sm text-rose-300">{error}</div>}
          {!loading && !error && runs.length === 0 && (
            <div className="text-sm text-[var(--muted)]">No previous generation runs found.</div>
          )}
          {runs.map((run) => (
            <RunCard
              key={run.slug}
              summary={run}
              expanded={expandedSlug === run.slug}
              onToggle={() =>
                setExpandedSlug((prev) => (prev === run.slug ? null : run.slug))
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
