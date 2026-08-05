"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import cytoscape, { type Core } from "cytoscape";
import EventLogEntries from "./EventLogEntries";
import GenerationHistory from "./GenerationHistory";
import {
  GENERATION_PHASES,
  applyStreamEventToEntries,
  formatStreamEvent,
  phaseDescription,
  phaseLabel,
  type LogEntry,
  type StreamEvent as LogStreamEvent,
} from "@/lib/generate/stream-log";

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

const PHASE_ORDER = [...GENERATION_PHASES, "done"] as const;

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
  const [stopped, setStopped] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [done, setDone] = useState(false);
  const [slug, setSlug] = useState<string | null>(null);
  const [phase, setPhase] = useState<string>("0_scope");
  const [importState, setImportState] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [elapsedSec, setElapsedSec] = useState(0);
  /** High-level “what’s happening right now” (LLM wait, embed, step…). */
  const [liveStatus, setLiveStatus] = useState<string>("");
  const [waitSec, setWaitSec] = useState(0);
  const [isWaiting, setIsWaiting] = useState(false);
  /** Phases seen so far (accordion headers). Only the current phase keeps entries in React state. */
  const [phaseOrder, setPhaseOrder] = useState<string[]>([]);
  const [phaseCounts, setPhaseCounts] = useState<Record<string, number>>({});
  const [currentPhaseName, setCurrentPhaseName] = useState("0_scope");
  const [currentEntries, setCurrentEntries] = useState<LogEntry[]>([]);
  /** Past phase bodies: loaded on open, deleted on close to free memory. */
  const [openPastPhases, setOpenPastPhases] = useState<
    Record<string, LogEntry[] | "loading" | "error">
  >({});

  const llmMessagesRef = useRef<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const esRef = useRef<EventSource | null>(null);
  const cyRef = useRef<Core | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const topicLabelRef = useRef<string>("");
  const pendingEventsRef = useRef<StreamEvent[]>([]);
  // Track the highest event id (byte offset) seen so reconnect replays are ignored.
  const lastSeenIdRef = useRef<number>(-1);
  const phaseStartRef = useRef<number>(Date.now());
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const placeIndexRef = useRef(0);
  const waitStartRef = useRef<number | null>(null);
  const waitTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventLogRef = useRef<HTMLDivElement | null>(null);
  const currentPhaseNameRef = useRef("0_scope");
  /** Only auto-scroll the current-phase log when the user is already near the bottom. */
  const stickToBottomRef = useRef(true);

  const progressPct = useMemo(() => {
    const idx = PHASE_ORDER.indexOf(done ? "done" : phase);
    if (idx < 0) return 0;
    return Math.round((idx / (PHASE_ORDER.length - 1)) * 100);
  }, [phase, done]);

  useEffect(() => {
    const el = eventLogRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [currentEntries, liveStatus, isWaiting, waitSec]);

  useEffect(() => {
    setPhaseCounts((prev) => {
      if (prev[currentPhaseName] === currentEntries.length) return prev;
      return { ...prev, [currentPhaseName]: currentEntries.length };
    });
  }, [currentEntries, currentPhaseName]);

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

  /**
   * Compact square-ish grid placement. Fixed cell size keeps the plane from
   * exploding (spiral/cose made nodes tiny when the viewport fitted a huge bbox).
   * Prefer a free cell near linked neighbors when possible; never re-layout others.
   */
  function placeNode(nodeId: string, nearIds: string[] = []) {
    const cy = cyRef.current;
    if (!cy) return;
    const node = cy.$id(nodeId);
    if (node.empty()) return;

    const CELL = 72;
    const occupied = new Set<string>();
    cy.nodes()
      .filter((n) => n.id() !== nodeId)
      .forEach((n) => {
        const p = n.position();
        occupied.add(`${Math.round(p.x / CELL)},${Math.round(p.y / CELL)}`);
      });

    const neighbors = nearIds
      .map((id) => cy.$id(id))
      .filter((n) => !n.empty() && n.id() !== nodeId);

    let preferX = 0;
    let preferY = 0;
    if (neighbors.length > 0) {
      const avg = neighbors.reduce(
        (acc, n) => {
          const p = n.position();
          return { x: acc.x + p.x, y: acc.y + p.y };
        },
        { x: 0, y: 0 }
      );
      preferX = avg.x / neighbors.length;
      preferY = avg.y / neighbors.length;
    } else {
      // Next slot in a growing square grid centered at origin.
      const i = placeIndexRef.current;
      const cols = Math.max(1, Math.ceil(Math.sqrt(i + 1)));
      const row = Math.floor(i / cols);
      const col = i % cols;
      preferX = (col - (cols - 1) / 2) * CELL;
      preferY = (row - (cols - 1) / 2) * CELL;
    }

    // Search outward from the preferred grid cell for the first free slot.
    const startC = Math.round(preferX / CELL);
    const startR = Math.round(preferY / CELL);
    let x = startC * CELL;
    let y = startR * CELL;
    let found = false;
    outer: for (let dist = 0; dist < 40; dist++) {
      for (let dc = -dist; dc <= dist; dc++) {
        for (let dr = -dist; dr <= dist; dr++) {
          if (dist > 0 && Math.max(Math.abs(dc), Math.abs(dr)) !== dist) continue;
          const key = `${startC + dc},${startR + dr}`;
          if (occupied.has(key)) continue;
          x = (startC + dc) * CELL;
          y = (startR + dr) * CELL;
          found = true;
          break outer;
        }
      }
    }
    if (!found) {
      const i = placeIndexRef.current;
      const cols = Math.max(1, Math.ceil(Math.sqrt(i + 1)));
      x = ((i % cols) - (cols - 1) / 2) * CELL;
      y = (Math.floor(i / cols) - (cols - 1) / 2) * CELL;
    }

    placeIndexRef.current += 1;
    node.position({ x, y });
  }

  function initCy(_topicLabel: string) {
    if (!containerRef.current) return;
    cyRef.current?.destroy();
    placeIndexRef.current = 0;
    cyRef.current = cytoscape({
      container: containerRef.current,
      elements: [],
      style: [
        {
          selector: "node",
          style: {
            "background-color": "#60a5fa",
            shape: (ele: any) => ele.data("shape") || "ellipse",
            width: 32,
            height: 32,
            label: "data(label)",
            color: "#e6e9ef",
            "font-size": 9,
            "text-wrap": "wrap",
            "text-max-width": "90px",
            "text-valign": "bottom",
            "text-margin-y": 4,
          },
        },
        {
          selector: "node[?is_seed]",
          style: {
            "background-color": "#34d399",
            width: 36,
            height: 36,
          },
        },
        {
          selector: "edge",
          style: {
            width: 1.5,
            "line-color": "#3a4455",
            "target-arrow-color": "#3a4455",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            opacity: 0.75,
          },
        },
        {
          selector: 'edge[type = "prerequisite_of"]',
          style: {
            "line-color": "#60a5fa",
            "target-arrow-color": "#60a5fa",
            width: 2,
            opacity: 0.9,
          },
        },
      ],
      layout: { name: "preset" },
      // Prevent "fit whole huge graph" from shrinking nodes to dots.
      minZoom: 0.45,
      maxZoom: 2.5,
      wheelSensitivity: 0.35,
    });
  }

  function appendPhaseText(text: string) {
    const phase = currentPhaseNameRef.current || "0_scope";
    setPhaseOrder((prev) => (prev.includes(phase) ? prev : [...prev, phase]));
    setCurrentEntries((prev) => [...prev, { kind: "text", text }]);
  }

  function beginPhase(name: string) {
    currentPhaseNameRef.current = name;
    setCurrentPhaseName(name);
    setPhaseOrder((prev) => (prev.includes(name) ? prev : [...prev, name]));
    setCurrentEntries([]);
    setPhaseCounts((prev) => ({ ...prev, [name]: 0 }));
    setOpenPastPhases((prev) => {
      if (!(name in prev)) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
    stickToBottomRef.current = true;
  }

  async function togglePastPhase(phase: string) {
    if (phase === currentPhaseNameRef.current) return;
    if (phase in openPastPhases) {
      // Close and drop entries from React state (RAM for that panel).
      setOpenPastPhases((prev) => {
        const next = { ...prev };
        delete next[phase];
        return next;
      });
      return;
    }
    if (!slug) return;
    setOpenPastPhases((prev) => ({ ...prev, [phase]: "loading" }));
    try {
      const resp = await fetch(
        `/api/generate/history?slug=${encodeURIComponent(slug)}&phase=${encodeURIComponent(phase)}`
      );
      const data = (await resp.json()) as {
        entries?: LogEntry[];
        lines?: string[];
        error?: string;
      };
      if (!resp.ok) throw new Error(data.error || "Failed to load phase log");
      setOpenPastPhases((prev) => ({ ...prev, [phase]: data.entries || [] }));
    } catch {
      setOpenPastPhases((prev) => ({ ...prev, [phase]: "error" }));
    }
  }

  function clearWaitTicker() {
    if (waitTickRef.current) {
      clearInterval(waitTickRef.current);
      waitTickRef.current = null;
    }
    waitStartRef.current = null;
    setWaitSec(0);
    setIsWaiting(false);
  }

  function beginWait(message: string) {
    setLiveStatus(message);
    setIsWaiting(true);
    waitStartRef.current = Date.now();
    setWaitSec(0);
    if (waitTickRef.current) clearInterval(waitTickRef.current);
    waitTickRef.current = setInterval(() => {
      if (waitStartRef.current == null) return;
      setWaitSec(Math.floor((Date.now() - waitStartRef.current) / 1000));
    }, 250);
  }

  function logStreamEvent(event: StreamEvent) {
    if (event.type === "phase" && typeof event.name === "string") {
      beginPhase(event.name);
    }

    const phase = currentPhaseNameRef.current || "0_scope";
    setPhaseOrder((prev) => (prev.includes(phase) ? prev : [...prev, phase]));
    setCurrentEntries((prev) =>
      applyStreamEventToEntries(prev, event as LogStreamEvent, {
        omitPhaseBanners: true,
      })
    );

    const line = formatStreamEvent(event as LogStreamEvent);
    if (event.type === "status" && typeof event.state === "string") {
      if (event.state === "waiting_llm" || event.state === "waiting_embed") {
        beginWait((line || "Waiting…").replace(/^⏳\s*/, ""));
      } else if (
        event.state === "llm_done" ||
        event.state === "embed_done" ||
        event.state === "llm_error"
      ) {
        clearWaitTicker();
        setLiveStatus((line || "").replace(/^[✓✗]\s*/, "") || "");
      }
    } else if (event.type === "step") {
      const detail =
        typeof event.detail === "string" && event.detail
          ? event.detail
          : line || "";
      if (detail) setLiveStatus(detail.replace(/^([→·]\s*)/, ""));
    } else if (event.type === "phase" && typeof event.name === "string") {
      setLiveStatus(`Entered ${phaseLabel(event.name)}`);
    } else if (event.type === "done" || event.type === "stopped") {
      clearWaitTicker();
      setLiveStatus(event.type === "done" ? "Generation finished" : "Stopped");
    }
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
      setStopped(false);
      setPhase("done");
      logStreamEvent(event);
      esRef.current?.close();
      esRef.current = null;
      return;
    }
    if (event.type === "stopped") {
      setRunning(false);
      setStopped(true);
      setStopping(false);
      logStreamEvent(event);
      esRef.current?.close();
      esRef.current = null;
      return;
    }
    if (event.type === "resumed") {
      setStopped(false);
      setRunning(true);
      logStreamEvent(event);
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
            label: event.name,
            shape: event.node_type === "procedure" ? "round-rectangle" : "ellipse",
            section_ref: event.section_ref || null,
            is_seed: !!event.is_seed,
          },
          position: { x: 0, y: 0 },
        });
        placeNode(event.ref);
      }
      logStreamEvent(event);
      return;
    }
    if (event.type === "seed" && typeof event.name === "string") {
      // Seeds are also emitted as nodes later; log only.
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
      // Add missing endpoints once, placed near their counterpart — do not move existing nodes.
      if (cy.$id(event.source).empty()) {
        cy.add({
          data: { id: event.source, label: event.source, shape: "ellipse" },
          position: { x: 0, y: 0 },
        });
        placeNode(event.source, [event.target]);
      }
      if (cy.$id(event.target).empty()) {
        cy.add({
          data: { id: event.target, label: event.target, shape: "ellipse" },
          position: { x: 0, y: 0 },
        });
        placeNode(event.target, [event.source]);
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
        // No global re-layout — edges draw between current positions.
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

  function connectStream(runSlug: string) {
    esRef.current?.close();
    const es = new EventSource(
      `/api/generate/stream?slug=${encodeURIComponent(runSlug)}`
    );
    esRef.current = es;
    let lastErrLog = 0;
    es.onmessage = (evt) => {
      const evtId = evt.lastEventId ? parseInt(evt.lastEventId, 10) : -1;
      if (evtId !== -1 && evtId <= lastSeenIdRef.current) return;
      if (evtId !== -1) lastSeenIdRef.current = evtId;
      try {
        const parsed = JSON.parse(evt.data) as StreamEvent;
        applyStreamEvent(parsed);
        } catch {
          appendPhaseText(evt.data);
        }
      };
    es.onerror = () => {
      // EventSource auto-reconnects; avoid spamming the log.
      const now = Date.now();
      if (now - lastErrLog > 5000) {
        lastErrLog = now;
        appendPhaseText("stream reconnecting…");
      }
    };
  }

  async function startGeneration() {
    if (!scope) return;
    const runSlug = `${slugify(scope.name)}-${Date.now()}`;
    setSlug(runSlug);
    setDone(false);
    setStopped(false);
    setRunning(true);
    setStarting(true);
    setImportState("");
    setPhase("0_scope");
    setPhaseOrder([]);
    setPhaseCounts({});
    setCurrentPhaseName("0_scope");
    setCurrentEntries([]);
    setOpenPastPhases({});
    currentPhaseNameRef.current = "0_scope";
    setError("");
    setElapsedSec(0);
    setLiveStatus("Starting generator process…");
    clearWaitTicker();
    stickToBottomRef.current = true;
    phaseStartRef.current = Date.now();
    topicLabelRef.current = scope.name;
    pendingEventsRef.current = [];
    lastSeenIdRef.current = -1;
    placeIndexRef.current = 0;
    // Destroy any prior cy so the running-effect re-inits cleanly.
    cyRef.current?.destroy();
    cyRef.current = null;

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
      connectStream(confirmedSlug);
    } catch (err) {
      setError(String(err));
      setRunning(false);
    } finally {
      setStarting(false);
    }
  }

  async function stopGeneration() {
    if (!slug || stopping) return;
    setStopping(true);
    setError("");
    try {
      const resp = await fetch("/api/generate/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      const data = (await resp.json()) as { error?: string };
      if (!resp.ok) {
        throw new Error(data.error || "Failed to stop generator");
      }
      // Stream will also emit {type:"stopped"}; set local state immediately for snappy UI.
      setRunning(false);
      setStopped(true);
      appendPhaseText("■ stop requested");
    } catch (err) {
      setError(String(err));
    } finally {
      setStopping(false);
    }
  }

  async function resumeGeneration() {
    if (!slug || !scope) return;
    setStarting(true);
    setError("");
    setDone(false);
    setStopped(false);
    setRunning(true);
    try {
      const resp = await fetch("/api/generate/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: scope.name,
          scopeDescription: scope.scope_description,
          scopeLevel: scope.scope_level,
          slug,
          resume: true,
        }),
      });
      const data = (await resp.json()) as { slug?: string; error?: string };
      if (!resp.ok) {
        throw new Error(data.error || "Failed to resume generator");
      }
      connectStream(data.slug || slug);
    } catch (err) {
      setError(String(err));
      setRunning(false);
      setStopped(true);
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

  // Initialise Cytoscape after the container div is in the DOM.
  useEffect(() => {
    if (!running && !stopped && !done) return;
    if (!containerRef.current) return;
    if (cyRef.current) return;
    initCy(topicLabelRef.current || "Topic");
    const pending = pendingEventsRef.current.splice(0);
    pending.forEach(applyStreamEvent);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, stopped, done]);

  useEffect(() => {
    return () => {
      esRef.current?.close();
      esRef.current = null;
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

      {(running || stopped || done) && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div className="text-sm text-[var(--muted)]">3) Live generation graph</div>
            <div className="ml-auto flex gap-2">
              {running && !done && (
                <button
                  type="button"
                  onClick={stopGeneration}
                  disabled={stopping}
                  className="rounded-md bg-rose-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                >
                  {stopping ? "Stopping…" : "Stop"}
                </button>
              )}
              {stopped && !done && (
                <button
                  type="button"
                  onClick={resumeGeneration}
                  disabled={starting}
                  className="rounded-md bg-amber-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                >
                  {starting ? "Resuming…" : "Resume"}
                </button>
              )}
            </div>
          </div>
          <div className="mb-2 flex items-center gap-3 text-xs text-[var(--muted)]">
            <span>slug: <code>{slug}</code></span>
            <span>
              phase:{" "}
              <code className="text-[var(--text)]">
                {phaseLabel(done ? "done" : phase)}
              </code>
            </span>
            {stopped && (
              <span className="text-amber-300">stopped — press Resume to continue</span>
            )}
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
          <div className="mb-3 flex flex-wrap gap-x-2 gap-y-1 text-xs text-[var(--muted)]">
            {PHASE_ORDER.map((p) => (
              <span
                key={p}
                className={
                  p === (done ? "done" : phase)
                    ? "font-semibold text-[var(--text)]"
                    : "text-[var(--muted)]"
                }
              >
                {phaseLabel(p)}
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
              {(running || liveStatus) && (
                <div className="mb-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-100">
                  <div className="font-semibold text-amber-200">
                    {isWaiting ? "Waiting on API" : running ? "Current step" : "Last status"}
                  </div>
                  <div className="mt-0.5 leading-snug">
                    {liveStatus || "Starting…"}
                    {isWaiting && (
                      <span className="ml-2 font-mono tabular-nums text-amber-300">
                        {Math.floor(waitSec / 60)}:{String(waitSec % 60).padStart(2, "0")} elapsed
                      </span>
                    )}
                  </div>
                </div>
              )}
              <div className="flex h-[52vh] flex-col gap-1 overflow-y-auto">
                {phaseOrder
                  .filter((p) => p !== currentPhaseName)
                  .map((p) => {
                    const open = p in openPastPhases;
                    const body = openPastPhases[p];
                    const count = phaseCounts[p] || 0;
                    return (
                      <div
                        key={p}
                        className="rounded border border-[var(--border)] bg-[var(--surface)]"
                      >
                        <button
                          type="button"
                          onClick={() => togglePastPhase(p)}
                          className="flex w-full items-start gap-2 px-2 py-1.5 text-left text-[10px] hover:bg-[var(--surface-2)]"
                        >
                          <span className="mt-0.5 text-[var(--muted)]">{open ? "▼" : "▶"}</span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-baseline gap-x-2">
                              <span className="font-medium text-sky-300">{phaseLabel(p)}</span>
                              <span className="text-[var(--muted)]">{count} events</span>
                              <span className="ml-auto text-[var(--muted)]">
                                {open ? "unload" : "load"}
                              </span>
                            </span>
                            {phaseDescription(p) && (
                              <span className="mt-0.5 block leading-snug text-[var(--text)]/80">
                                {phaseDescription(p)}
                              </span>
                            )}
                          </span>
                        </button>
                        {open && (
                          <div className="max-h-56 overflow-y-auto border-t border-[var(--border)] p-2 font-mono text-[10px] leading-relaxed">
                            {body === "loading" && (
                              <div className="text-[var(--muted)]">Loading from disk…</div>
                            )}
                            {body === "error" && (
                              <div className="text-rose-400">Failed to load phase log.</div>
                            )}
                            {Array.isArray(body) && <EventLogEntries entries={body} />}
                          </div>
                        )}
                      </div>
                    );
                  })}

                <div className="flex min-h-0 flex-1 flex-col rounded border border-sky-500/40 bg-[var(--surface)]">
                  <div className="border-b border-[var(--border)] px-2 py-1.5 text-[10px]">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sky-300">
                        {phaseLabel(currentPhaseName)}
                      </span>
                      <span className="text-[var(--muted)]">
                        {phaseCounts[currentPhaseName] || currentEntries.length} steps · live
                      </span>
                    </div>
                    {phaseDescription(currentPhaseName) && (
                      <div className="mt-0.5 leading-snug text-[var(--text)]/80">
                        {phaseDescription(currentPhaseName)}
                      </div>
                    )}
                  </div>
                  <div
                    ref={eventLogRef}
                    onScroll={(e) => {
                      const el = e.currentTarget;
                      const distanceFromBottom =
                        el.scrollHeight - el.scrollTop - el.clientHeight;
                      stickToBottomRef.current = distanceFromBottom < 48;
                    }}
                    className="min-h-0 flex-1 overflow-y-auto p-2 font-mono text-[10px] leading-relaxed"
                  >
                    {currentEntries.length === 0 ? (
                      <div className="text-[var(--muted)]">Waiting for events…</div>
                    ) : (
                      <EventLogEntries entries={currentEntries} />
                    )}
                  </div>
                </div>
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
