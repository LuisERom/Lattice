"use client";

import { useEffect, useState } from "react";
import type {
  ApiCallDetailResponse,
  GenerationPhaseOutline,
  GenerationRunSummary,
  PhaseDetailResponse,
  RunOutlineResponse,
} from "@/lib/generate/history";
import type { PhaseTimelineApiCallRow, PhaseTimelineEventRow } from "@/lib/generate/stream-log";

function statusLabel(summary: GenerationRunSummary): string {
  if (summary.isLive) return "running";
  if (summary.status === "completed") return "completed";
  if (summary.status === "failed") return "failed";
  return "in progress";
}

function statusClass(summary: GenerationRunSummary): string {
  if (summary.isLive) return "text-sky-300";
  if (summary.status === "completed") return "text-emerald-400";
  if (summary.status === "failed") return "text-rose-400";
  return "text-amber-300";
}

function formatWhen(iso: string | null): string {
  if (!iso) return "unknown time";
  return new Date(iso).toLocaleString();
}

function formatElapsed(ms: number | null): string {
  if (typeof ms !== "number") return "n/a";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function toneClass(tone: PhaseTimelineEventRow["tone"]): string {
  if (tone === "error") return "text-rose-300";
  if (tone === "warning") return "text-amber-300";
  if (tone === "success") return "text-emerald-300";
  return "text-[var(--text)]";
}

function OutcomeSections({ sections }: { sections: PhaseDetailResponse["outcome"] }) {
  if (sections.length === 0) {
    return <div className="text-[var(--muted)]">No checkpoint outcome recorded.</div>;
  }
  return (
    <div className="space-y-2">
      {sections.map((section, idx) => (
        <div key={`${section.title}-${idx}`} className="rounded border border-[var(--border)] bg-[var(--background)] p-2">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            {section.title}
          </div>
          <div className="space-y-1 text-[11px] text-[var(--text)]">
            {section.lines.map((line, lineIdx) => (
              <div key={`${line}-${lineIdx}`}>{line}</div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ApiCallToggle({
  slug,
  phase,
  row,
}: {
  slug: string;
  phase: string;
  row: PhaseTimelineApiCallRow;
}) {
  const [open, setOpen] = useState(false);
  const [callDetail, setCallDetail] = useState<ApiCallDetailResponse["call"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadCall(): Promise<void> {
    if (loading || callDetail) return;
    setLoading(true);
    setError("");
    try {
      const resp = await fetch(
        `/api/generate/history?slug=${encodeURIComponent(slug)}&phase=${encodeURIComponent(phase)}&call=${encodeURIComponent(row.callId)}`
      );
      const data = (await resp.json()) as ApiCallDetailResponse & { error?: string };
      if (!resp.ok) throw new Error(data.error || "Failed to load API call detail");
      setCallDetail(data.call);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded border border-[var(--border)] bg-[var(--surface)]">
      <button
        type="button"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next && !callDetail) {
            void loadCall();
          }
        }}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-[var(--surface-2)]"
      >
        <span className="text-[var(--muted)]">{open ? "▼" : "▶"}</span>
        <span className="text-[11px] text-sky-300">API</span>
        <span className="font-mono text-[11px] text-[var(--text)]">{row.label}</span>
        <span className="text-[11px] text-[var(--muted)]">{row.model}</span>
        <span
          className={`ml-auto text-[11px] ${
            row.status === "done"
              ? "text-emerald-400"
              : row.status === "error"
                ? "text-rose-400"
                : "text-amber-300"
          }`}
        >
          {row.status}
        </span>
        <span className="text-[11px] text-[var(--muted)]">{formatElapsed(row.elapsedMs)}</span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-[var(--border)] p-2 text-[11px]">
          {loading && <div className="text-[var(--muted)]">Loading API call detail...</div>}
          {error && <div className="text-rose-300">{error}</div>}
          {!loading && !error && callDetail && (
            <>
              <div className="text-[var(--muted)]">
                {callDetail.legacy && "Legacy run · "}
                {callDetail.requestMessages.length} message(s) sent · elapsed {formatElapsed(callDetail.elapsedMs)}
              </div>

              <div className="rounded border border-[var(--border)] bg-[var(--background)] p-2">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--muted)]">
                  Request Messages
                </div>
                {callDetail.requestMessages.length === 0 ? (
                  <div className="text-[var(--muted)]">No request payload stored.</div>
                ) : (
                  <div className="max-h-56 space-y-2 overflow-y-auto">
                    {callDetail.requestMessages.map((msg, idx) => (
                      <div key={`${msg.role}-${idx}`} className="rounded border border-[var(--border)] bg-[var(--surface)] p-2">
                        <div className="mb-1 font-semibold text-[var(--muted)]">{msg.role}</div>
                        <pre className="whitespace-pre-wrap font-mono text-[10px] text-[var(--text)]">
                          {msg.content}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded border border-[var(--border)] bg-[var(--background)] p-2">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--muted)]">
                  Response
                </div>
                {!callDetail.responseStored ? (
                  <div className="text-[var(--muted)]">Not stored for this run.</div>
                ) : (
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-[var(--text)]">
                    {JSON.stringify(callDetail.response, null, 2)}
                  </pre>
                )}
              </div>

              {callDetail.errorMessage && (
                <div className="rounded border border-rose-400/40 bg-rose-500/10 p-2 text-rose-200">
                  {callDetail.errorMessage}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PhaseToggle({
  slug,
  outline,
}: {
  slug: string;
  outline: GenerationPhaseOutline;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<PhaseDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadPhase(): Promise<void> {
    if (loading || detail) return;
    setLoading(true);
    setError("");
    try {
      const resp = await fetch(
        `/api/generate/history?slug=${encodeURIComponent(slug)}&phase=${encodeURIComponent(outline.phase)}`
      );
      const data = (await resp.json()) as PhaseDetailResponse & { error?: string };
      if (!resp.ok) throw new Error(data.error || "Failed to load phase detail");
      setDetail(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded border border-[var(--border)] bg-[var(--surface)]">
      <button
        type="button"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next && !detail) {
            void loadPhase();
          }
        }}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-[var(--surface-2)]"
      >
        <span className="text-[var(--muted)]">{open ? "▼" : "▶"}</span>
        <span className="font-mono text-sky-300">{outline.phase}</span>
        <span className="text-[11px] text-[var(--muted)]">{outline.apiCallCount} API call(s)</span>
        {outline.completed && <span className="text-[11px] text-emerald-400">checkpoint</span>}
      </button>

      {open && (
        <div className="space-y-2 border-t border-[var(--border)] p-2 text-xs">
          <div className="text-[var(--muted)]">{outline.description}</div>

          <OutcomeSections sections={detail?.outcome || outline.outcome} />

          {loading && <div className="text-[var(--muted)]">Loading execution timeline...</div>}
          {error && <div className="text-rose-300">{error}</div>}

          {!loading && !error && detail && (
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
                Execution Timeline
              </div>
              {detail.timeline.length === 0 ? (
                <div className="text-[var(--muted)]">No stream events recorded for this phase.</div>
              ) : (
                <div className="max-h-80 space-y-1 overflow-y-auto rounded border border-[var(--border)] bg-[var(--background)] p-2">
                  {detail.timeline.map((row) =>
                    row.kind === "api_call" ? (
                      <ApiCallToggle key={row.id} slug={slug} phase={outline.phase} row={row} />
                    ) : (
                      <div key={row.id} className="rounded border border-[var(--border)] bg-[var(--surface)] p-2">
                        <div className={`text-[11px] ${toneClass(row.tone)}`}>{row.label}</div>
                        {row.detail && (
                          <div className="mt-1 text-[10px] text-[var(--muted)]">{row.detail}</div>
                        )}
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
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
  const [outline, setOutline] = useState<RunOutlineResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const displaySummary = outline?.summary || summary;

  useEffect(() => {
    if (!expanded || outline) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(`/api/generate/history?slug=${encodeURIComponent(summary.slug)}`)
      .then(async (resp) => {
        const data = (await resp.json()) as RunOutlineResponse & { error?: string };
        if (!resp.ok) throw new Error(data.error || "Failed to load run details");
        if (!cancelled) setOutline(data);
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
  }, [expanded, outline, summary.slug]);

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--background)]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--surface-2)]"
      >
        <span className="text-[var(--muted)]">{expanded ? "▼" : "▶"}</span>
        <span className="font-medium text-[var(--text)]">{displaySummary.name}</span>
        <span className="font-mono text-xs text-[var(--muted)]">{displaySummary.slug}</span>
        <span className={`ml-auto text-xs ${statusClass(displaySummary)}`}>
          {statusLabel(displaySummary)}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">
          <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
            <span>Level: {displaySummary.scopeLevel}</span>
            <span>Started: {formatWhen(displaySummary.startedAt)}</span>
            <span>Updated: {formatWhen(displaySummary.updatedAt)}</span>
            {typeof displaySummary.eventCount === "number" ? (
              <span>{displaySummary.eventCount} stream events</span>
            ) : (
              <span>stream events: lazy-loaded</span>
            )}
            {displaySummary.hasImport && <span className="text-emerald-400">imported</span>}
            {displaySummary.lastPhase && <span>Last phase: {displaySummary.lastPhase}</span>}
          </div>
          {displaySummary.scopeDescription && (
            <p className="mb-2 text-[var(--text)]">{displaySummary.scopeDescription}</p>
          )}

          {loading && <div>Loading phase outlines...</div>}
          {error && <div className="text-rose-300">{error}</div>}

          {!loading && !error && outline && (
            <div className="space-y-2">
              {outline.phases.map((phase) => (
                <PhaseToggle key={phase.phase} slug={summary.slug} outline={phase} />
              ))}
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
