"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import cytoscape, { type Core } from "cytoscape";
import GenerationHistory from "./GenerationHistory";
import { formatStreamEvent, type StreamEvent as LogStreamEvent } from "@/lib/generate/stream-log";

type InterviewMessage = {
  role: "user" | "assistant";
  content: string;
};

type ScopePayload = {
  name: string;
  scope_level: "working" | "deep" | "exam-ready";
  scope_description: string;
  include: string[];
  exclude: string[];
  summary: string;
  outline?: Array<{
    section: string;
    in?: string;
    out?: string;
    subsections?: string[];
  }>;
};

type StreamEvent =
  | { type: "phase"; name: string }
  | {
      type: "node";
      ref: string;
      name: string;
      node_type?: "concept" | "procedure";
      section_ref?: string;
    }
  | {
      type: "node_update";
      ref: string;
      description?: string;
      grounding_sensitive?: boolean;
    }
  | {
      type: "edge";
      ref?: string;
      source: string;
      target: string;
      edge_type: string;
      order_index?: number | null;
    }
  | { type: "done" }
  | { type: "error"; message: string }
  | { type: string; [k: string]: unknown };

const PHASE_ORDER = [
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
  "done",
];

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "topic";
}

function normalizeScope(raw: unknown, fallbackName: string): ScopePayload | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<ScopePayload> & { include?: unknown; exclude?: unknown; outline?: unknown };
  const level =
    s.scope_level === "working" || s.scope_level === "exam-ready" ? s.scope_level : "deep";
  const include = Array.isArray(s.include) ? s.include.map(String) : [];
  const exclude = Array.isArray(s.exclude) ? s.exclude.map(String) : [];
  const description = String(s.scope_description || "").trim();
  return {
    name: String(s.name || fallbackName),
    scope_level: level,
    scope_description: description,
    include,
    exclude,
    summary: String(s.summary || description.slice(0, 160)),
    outline: Array.isArray(s.outline) ? (s.outline as ScopePayload["outline"]) : [],
  };
}

export default function GeneratePage() {
  const [subject, setSubject] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chat, setChat] = useState<InterviewMessage[]>([]);
  const [scope, setScope] = useState<ScopePayload | null>(null);
  const [interviewing, setInterviewing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [slug, setSlug] = useState<string | null>(null);
  const [phase, setPhase] = useState<string>("0_scope");
  const [importState, setImportState] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [eventLog, setEventLog] = useState<string[]>([]);
  const [elapsedSec, setElapsedSec] = useState(0);

  const llmMessagesRef = useRef<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const esRef = useRef<EventSource | null>(null);
  const cyRef = useRef<Core | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const layoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const topicLabelRef = useRef<string>("");
  const pendingEventsRef = useRef<StreamEvent[]>([]);
  // Track the highest event id (byte offset) seen so reconnect replays are ignored.
  const lastSeenIdRef = useRef<number>(-1);
  const phaseStartRef = useRef<number>(Date.now());
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const progressPct = useMemo(() => {
    const idx = PHASE_ORDER.indexOf(done ? "done" : phase);
    if (idx < 0) return 0;
    return Math.round((idx / (PHASE_ORDER.length - 1)) * 100);
  }, [phase, done]);

  // Tick the phase elapsed timer every second while running.
  useEffect(() => {
    if (!running || done) {
      if (elapsedIntervalRef.current) {
        clearInterval(elapsedIntervalRef.current);
        elapsedIntervalRef.current = null;
      }
      return;
    }
    phaseStartRef.current = Date.now();
    elapsedIntervalRef.current = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - phaseStartRef.current) / 1000));
    }, 1000);
    return () => {
      if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current);
    };
  }, [running, done]);

  function scheduleLayout() {
    if (!cyRef.current) return;
    if (layoutTimerRef.current) clearTimeout(layoutTimerRef.current);
    layoutTimerRef.current = setTimeout(() => {
      cyRef.current?.layout({ name: "cose", animate: false, padding: 28, nodeRepulsion: 9000 }).run();
    }, 250);
  }

  function initCy(topicLabel: string) {
    if (!containerRef.current) return;
    cyRef.current?.destroy();
    cyRef.current = cytoscape({
      container: containerRef.current,
      elements: [{ data: { id: "topic", label: topicLabel } }],
      style: [
        {
          selector: "#topic",
          style: {
            "background-color": "transparent",
            "background-opacity": 0.04,
            "border-width": 2,
            "border-color": "#5b6b8c",
            shape: "round-rectangle",
            label: "data(label)",
            "text-valign": "top",
            "text-halign": "center",
            "font-size": 11,
            color: "#8a93a3",
            padding: "28px",
          },
        },
        {
          selector: "node[id != 'topic']",
          style: {
            "background-color": "#60a5fa",
            shape: (ele: any) => ele.data("shape"),
            width: 32,
            height: 32,
            label: "data(label)",
            color: "#e6e9ef",
            "font-size": 9,
            "text-wrap": "wrap",
            "text-max-width": "90px",
            "text-valign": "bottom",
            "text-margin-y": 4,
            "border-width": 0,
          },
        },
        {
          selector: "edge",
          style: {
            width: 1.5,
            "line-color": "#3a4455",
            "target-arrow-color": "#3a4455",
            "target-arrow-shape": "triangle",
            "arrow-scale": 0.8,
            "curve-style": "straight",
            opacity: 0.75,
          },
        },
      ],
      layout: { name: "grid", animate: false },
      wheelSensitivity: 1,
    });
  }

  function appendLog(text: string) {
    setEventLog((prev) => [...prev.slice(-200), text]);
  }

  function logStreamEvent(event: StreamEvent) {
    const line = formatStreamEvent(event as LogStreamEvent);
    if (line) appendLog(line);
  }

  function applyStreamEvent(event: StreamEvent) {
    if (event.type === "phase" && typeof event.name === "string") {
      setPhase(event.name);
      setElapsedSec(0);
      phaseStartRef.current = Date.now();
      logStreamEvent(event);
      return;
    }
    if (event.type === "done") {
      setDone(true);
      setRunning(false);
      setPhase("done");
      logStreamEvent(event);
      esRef.current?.close();
      esRef.current = null;
      return;
    }
    if (event.type === "error") {
      const msg = typeof event.message === "string" ? event.message : JSON.stringify(event);
      setError(`Generator error: ${msg}`);
      logStreamEvent(event);
      return;
    }

    const cy = cyRef.current;
    if (!cy) {
      // Cytoscape not ready yet — buffer graph events; they are drained once cy initialises
      pendingEventsRef.current.push(event);
      return;
    }

    if (
      event.type === "node" &&
      typeof event.ref === "string" &&
      typeof event.name === "string"
    ) {
      if (cy.$id(event.ref).empty()) {
        cy.add({
          data: {
            id: event.ref,
            parent: "topic",
            label: event.name,
            shape: event.node_type === "procedure" ? "round-rectangle" : "ellipse",
            section_ref: event.section_ref || null,
          },
        });
        scheduleLayout();
      }
      logStreamEvent(event);
      return;
    }
    if (event.type === "node_update" && typeof event.ref === "string") {
      const node = cy.$id(event.ref);
      if (!node.empty()) {
        node.data("description", event.description || "");
        node.data("grounding_sensitive", !!event.grounding_sensitive);
      }
      logStreamEvent(event);
      return;
    }
    if (
      event.type === "edge" &&
      typeof event.source === "string" &&
      typeof event.target === "string" &&
      typeof event.edge_type === "string"
    ) {
      if (cy.$id(event.source).empty()) {
        cy.add({ data: { id: event.source, parent: "topic", label: event.source, shape: "ellipse" } });
      }
      if (cy.$id(event.target).empty()) {
        cy.add({ data: { id: event.target, parent: "topic", label: event.target, shape: "ellipse" } });
      }
      const edgeId =
        typeof event.ref === "string" && event.ref
          ? event.ref
          : `e-${event.source}-${event.target}-${event.edge_type}`;
      if (cy.$id(edgeId).empty()) {
        cy.add({
          data: {
            id: edgeId,
            source: event.source,
            target: event.target,
            type: event.edge_type,
            order_index: event.order_index ?? null,
          },
        });
        scheduleLayout();
      }
      logStreamEvent(event);
      return;
    }
    logStreamEvent(event);
  }

  async function requestInterviewTurn() {
    setInterviewing(true);
    setError("");
    try {
      const resp = await fetch("/api/generate/interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: undefined,
          messages: llmMessagesRef.current,
        }),
      });
      const data = (await resp.json()) as
        | ({ type: "question"; question: string; rationale?: string } & Record<string, unknown>)
        | ({ type: "scope" } & ScopePayload & Record<string, unknown>);
      if (!resp.ok) {
        throw new Error((data as { error?: string }).error || "Interview request failed");
      }
      llmMessagesRef.current = [
        ...llmMessagesRef.current,
        { role: "assistant", content: JSON.stringify(data) },
      ];

      if (data.type === "scope") {
        const normalized = normalizeScope(data, subject);
        if (!normalized) throw new Error("Invalid scope payload");
        setScope(normalized);
        setChat((prev) => [
          ...prev,
          { role: "assistant", content: normalized.summary || "Scope ready. Start generation when ready." },
        ]);
      } else {
        const line = data.rationale
          ? `${data.question}\n\n(${data.rationale})`
          : data.question;
        setChat((prev) => [...prev, { role: "assistant", content: line }]);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setInterviewing(false);
    }
  }

  async function startInterview() {
    if (!subject.trim()) {
      setError("Enter a subject first.");
      return;
    }
    setError("");
    setScope(null);
    setChat([{ role: "assistant", content: "Starting scope interview..." }]);
    const seed = {
      role: "user" as const,
      content: `The subject to scope is: ${subject.trim()}\nInterview me to define boundary, then finalize as type:scope JSON with include/exclude and outline.`,
    };
    llmMessagesRef.current = [seed];
    await requestInterviewTurn();
  }

  async function sendInterviewAnswer() {
    const answer = chatInput.trim();
    if (!answer) return;
    setChatInput("");
    setChat((prev) => [...prev, { role: "user", content: answer }]);
    llmMessagesRef.current = [
      ...llmMessagesRef.current,
      { role: "user", content: answer },
    ];
    await requestInterviewTurn();
  }

  async function startGeneration() {
    if (!scope) return;
    const runSlug = `${slugify(scope.name)}-${Date.now()}`;
    setSlug(runSlug);
    setDone(false);
    setRunning(true);
    setStarting(true);
    setImportState("");
    setPhase("0_scope");
    setEventLog([]);
    setError("");
    setElapsedSec(0);
    phaseStartRef.current = Date.now();
    topicLabelRef.current = scope.name;
    pendingEventsRef.current = [];
    lastSeenIdRef.current = -1;
    // initCy is called by the useEffect once the container div is in the DOM

    try {
      const resp = await fetch("/api/generate/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: scope.name,
          scopeDescription: scope.scope_description,
          scopeLevel: scope.scope_level,
          slug: runSlug,
        }),
      });
      const data = (await resp.json()) as { slug?: string; error?: string };
      if (!resp.ok) {
        throw new Error(data.error || "Failed to start generator");
      }
      const confirmedSlug = data.slug || runSlug;
      setSlug(confirmedSlug);

      const es = new EventSource(
        `/api/generate/stream?slug=${encodeURIComponent(confirmedSlug)}`
      );
      esRef.current = es;
      es.onmessage = (evt) => {
        // Skip events already processed (replayed after an automatic reconnect).
        const evtId = evt.lastEventId ? parseInt(evt.lastEventId, 10) : -1;
        if (evtId !== -1 && evtId <= lastSeenIdRef.current) return;
        if (evtId !== -1) lastSeenIdRef.current = evtId;
        try {
          const parsed = JSON.parse(evt.data) as StreamEvent;
          applyStreamEvent(parsed);
        } catch {
          appendLog(evt.data);
        }
      };
      es.onerror = () => {
        appendLog("stream error");
      };
    } catch (err) {
      setError(String(err));
      setRunning(false);
    } finally {
      setStarting(false);
    }
  }

  async function importGenerated() {
    if (!slug) return;
    setImportState("Importing...");
    try {
      const resp = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      const data = (await resp.json()) as {
        error?: string;
        topicName?: string;
        topicId?: number;
        counts?: Record<string, number>;
      };
      if (!resp.ok) {
        throw new Error(data.error || "Import failed");
      }
      setImportState(
        `Imported "${data.topicName}" (topic id ${data.topicId}). Counts: ${JSON.stringify(
          data.counts
        )}`
      );
    } catch (err) {
      setImportState(`Import failed: ${String(err)}`);
    }
  }

  // Initialise Cytoscape after the container div is in the DOM (running === true triggers render).
  useEffect(() => {
    if (!running) return;
    if (!containerRef.current) return;
    if (cyRef.current) return;
    initCy(topicLabelRef.current || "Topic");
    // Drain events that arrived before cy was ready
    const pending = pendingEventsRef.current.splice(0);
    pending.forEach(applyStreamEvent);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  useEffect(() => {
    return () => {
      esRef.current?.close();
      esRef.current = null;
      if (layoutTimerRef.current) clearTimeout(layoutTimerRef.current);
      cyRef.current?.destroy();
      cyRef.current = null;
    };
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Generate Topic (Live)</h1>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="mb-2 text-sm text-[var(--muted)]">1) Scope interview</div>
        <div className="flex gap-2">
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            placeholder="Subject (e.g. Django REST Framework)"
            disabled={running}
          />
          <button
            onClick={startInterview}
            disabled={interviewing || running}
            className="rounded-md bg-[var(--accent)] px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            {interviewing ? "Thinking..." : "Start interview"}
          </button>
        </div>

        {chat.length > 0 && (
          <div className="mt-3 space-y-2 rounded-md border border-[var(--border)] bg-[var(--background)] p-3">
            <div className="max-h-72 space-y-2 overflow-y-auto text-sm">
              {chat.map((m, idx) => (
                <div
                  key={idx}
                  className={`rounded px-2 py-1 ${
                    m.role === "assistant"
                      ? "bg-[var(--surface-2)] text-[var(--text)]"
                      : "bg-sky-500/10 text-sky-200"
                  }`}
                >
                  <div className="mb-0.5 text-[10px] uppercase opacity-70">{m.role}</div>
                  <pre className="whitespace-pre-wrap font-sans">{m.content}</pre>
                </div>
              ))}
            </div>
            {!scope && (
              <div className="flex gap-2">
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                  placeholder="Answer..."
                  onKeyDown={(e) => {
                    if (e.key === "Enter") sendInterviewAnswer();
                  }}
                  disabled={interviewing}
                />
                <button
                  onClick={sendInterviewAnswer}
                  disabled={interviewing}
                  className="rounded-md bg-[var(--accent)] px-3 py-2 text-sm text-white disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {scope && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="mb-2 text-sm text-[var(--muted)]">2) Frozen scope</div>
          <div className="text-sm">
            <div>
              <span className="text-[var(--muted)]">Name:</span> {scope.name}
            </div>
            <div>
              <span className="text-[var(--muted)]">Level:</span> {scope.scope_level}
            </div>
            <div className="mt-1 text-[var(--muted)]">{scope.summary}</div>
            {scope.include.length > 0 && (
              <div className="mt-1">
                <span className="text-[var(--muted)]">In:</span>{" "}
                {scope.include.join(", ")}
              </div>
            )}
            {scope.exclude.length > 0 && (
              <div className="mt-1">
                <span className="text-[var(--muted)]">Out:</span>{" "}
                {scope.exclude.join(", ")}
              </div>
            )}
          </div>
          <button
            onClick={startGeneration}
            disabled={starting || running}
            className="mt-3 rounded-md bg-emerald-600 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            {starting ? "Starting..." : "Start generation"}
          </button>
        </div>
      )}

      {(running || done) && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="mb-2 text-sm text-[var(--muted)]">3) Live generation graph</div>
          <div className="mb-2 flex items-center gap-3 text-xs text-[var(--muted)]">
            <span>slug: <code>{slug}</code></span>
            <span>phase: <code className="text-[var(--text)]">{done ? "done" : phase}</code></span>
            {running && !done && (
              <span className="font-mono tabular-nums text-amber-400">
                {Math.floor(elapsedSec / 60)}:{String(elapsedSec % 60).padStart(2, "0")} in phase
              </span>
            )}
          </div>
          <div className="mb-2 h-2 w-full rounded bg-[var(--surface-2)]">
            <div
              className="h-2 rounded bg-[var(--accent)] transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="mb-3 text-xs text-[var(--muted)]">
            {PHASE_ORDER.map((p) => (
              <span
                key={p}
                className={`mr-2 ${
                  p === (done ? "done" : phase)
                    ? "font-semibold text-[var(--text)]"
                    : "text-[var(--muted)]"
                }`}
              >
                {p}
              </span>
            ))}
          </div>
          <div className="flex gap-4">
            <div
              ref={containerRef}
              className="h-[68vh] flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)]"
            />
            <div className="w-96 shrink-0 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
              <div className="mb-2 text-xs uppercase text-[var(--muted)]">Live events</div>
              <div
                ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}
                className="h-[56vh] overflow-y-auto rounded border border-[var(--border)] bg-[var(--surface)] p-2 font-mono text-[10px] leading-relaxed"
              >
                {eventLog.length === 0 ? (
                  <div className="text-[var(--muted)]">Waiting for events...</div>
                ) : (
                  eventLog.map((line, i) => {
                    const isPhase = line.startsWith("▶");
                    const isDone = line.startsWith("✓");
                    const isError = line.startsWith("✗");
                    return (
                      <div
                        key={i}
                        className={`border-b border-[var(--border)] py-0.5 last:border-b-0 ${
                          isError ? "text-rose-400" :
                          isDone ? "text-emerald-400" :
                          isPhase ? "text-sky-300 font-semibold" :
                          "text-[var(--muted)]"
                        }`}
                      >
                        {line}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
          {done && (
            <div className="mt-3 space-y-2">
              <button
                onClick={importGenerated}
                className="rounded-md bg-emerald-600 px-3 py-2 text-sm text-white"
              >
                Import now
              </button>
              {importState && <div className="text-sm text-[var(--muted)]">{importState}</div>}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="rounded border border-rose-500/60 bg-rose-500/10 p-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      <GenerationHistory />
    </div>
  );
}
