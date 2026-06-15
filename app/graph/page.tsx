"use client";

import { useEffect, useRef, useState } from "react";
import cytoscape, { type Core } from "cytoscape";

interface GraphNode {
  id: number;
  name: string;
  type: string;
  status: string;
  due: boolean;
  centrality: number;
  difficulty: number;
}
interface GraphEdge {
  id: number;
  source: number;
  target: number;
  type: string;
}
interface GraphView {
  topicName: string | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const STATUS_COLOR: Record<string, string> = {
  locked: "#4b5563",
  learning: "#f59e0b",
  known: "#3b82f6",
  mastered: "#22c55e",
};

const STATUS_LABEL = ["locked", "learning", "known", "mastered"];

interface NodeDetail {
  id: number;
  name: string;
  type: string;
  description: string;
  difficulty: number;
  centrality: number;
  verification: string;
  grounding_sensitive: boolean;
  locked: boolean;
  known: boolean;
  edges: {
    id: number;
    type: string;
    direction: string;
    otherName: string;
    order_index: number | null;
  }[];
  items: {
    itemId: number;
    kind: string;
    status: string;
    R: number;
    due: string;
    isDue: boolean;
    distinctMethodsPassed: number;
    reviewState: {
      state: number;
      stability: number;
      reps: number;
      lapses: number;
      due: string;
    };
    methodProgress: { method: string; passed: number; times_correct: number }[];
    methods: string[];
  }[];
}

export default function GraphPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [topicName, setTopicName] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  const [detail, setDetail] = useState<NodeDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = (await (await fetch("/api/graph")).json()) as GraphView;
      if (cancelled || !containerRef.current) return;
      setTopicName(data.topicName);
      if (data.nodes.length === 0) {
        setEmpty(true);
        return;
      }

      const elements = [
        ...data.nodes.map((n) => ({
          data: {
            id: `n${n.id}`,
            label: n.name,
            status: n.status,
            shape: n.type === "procedure" ? "round-rectangle" : "ellipse",
            due: n.due,
            size: 26 + n.centrality * 34,
          },
        })),
        ...data.edges.map((e) => ({
          data: {
            id: `e${e.id}`,
            source: `n${e.source}`,
            target: `n${e.target}`,
            type: e.type,
            prereq: e.type === "prerequisite_of",
          },
        })),
      ];

      const cy = cytoscape({
        container: containerRef.current,
        elements,
        style: [
          {
            selector: "node",
            style: {
              "background-color": (ele) =>
                STATUS_COLOR[ele.data("status")] ?? "#888",
              shape: (ele: any) => ele.data("shape"),
              width: (ele: any) => ele.data("size"),
              height: (ele: any) => ele.data("size"),
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
            selector: "node[?due]",
            style: {
              "border-width": 4,
              "border-color": "#fb923c",
              "border-style": "double",
            },
          },
          {
            selector: "node:selected",
            style: { "border-width": 4, "border-color": "#e6e9ef" },
          },
          {
            selector: "edge",
            style: {
              width: 1.5,
              "line-color": "#3a4455",
              "target-arrow-color": "#3a4455",
              "target-arrow-shape": "triangle",
              "curve-style": "bezier",
              opacity: 0.6,
            },
          },
          {
            selector: "edge[?prereq]",
            style: { "line-color": "#5b6b8c", "target-arrow-color": "#5b6b8c", opacity: 0.9 },
          },
        ],
        layout: { name: "cose", animate: false, padding: 30, nodeRepulsion: 9000 },
        wheelSensitivity: 1,
      });

      cy.on("tap", "node", async (evt) => {
        const raw = evt.target.id() as string;
        const id = Number(raw.startsWith("n") ? raw.slice(1) : raw);
        const d = (await (await fetch(`/api/node/${id}`)).json()) as NodeDetail;
        setDetail(d);
      });
      cy.on("tap", (evt) => {
        if (evt.target === cy) setDetail(null);
      });

      cyRef.current = cy;
    })();
    return () => {
      cancelled = true;
      cyRef.current?.destroy();
      cyRef.current = null;
    };
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          Graph{topicName ? <span className="text-[var(--muted)]"> — {topicName}</span> : null}
        </h1>
        <Legend />
      </div>

      {empty ? (
        <p className="mt-6 text-[var(--muted)]">
          No topic imported yet. Run <code>npm run import</code> to load the seed.
        </p>
      ) : (
        <div className="mt-4 flex gap-4">
          <div
            ref={containerRef}
            className="h-[72vh] flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)]"
          />
          <Inspector detail={detail} />
        </div>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
      {STATUS_LABEL.map((s) => (
        <span key={s} className="flex items-center gap-1">
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ background: STATUS_COLOR[s] }}
          />
          {s}
        </span>
      ))}
      <span className="flex items-center gap-1">
        <span className="inline-block h-3 w-3 rounded-full border-2 border-[#fb923c]" />
        due
      </span>
    </div>
  );
}

function Inspector({ detail }: { detail: NodeDetail | null }) {
  if (!detail) {
    return (
      <div className="w-80 shrink-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">
        Click a node to inspect it.
      </div>
    );
  }
  const stateNames = ["New", "Learning", "Review", "Relearning"];
  return (
    <div className="w-80 shrink-0 space-y-4 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
      <div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-xs text-[var(--muted)]">
            {detail.type}
          </span>
          {detail.locked && (
            <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-xs text-[var(--muted)]">
              locked
            </span>
          )}
        </div>
        <h2 className="mt-2 text-base font-semibold">{detail.name}</h2>
        <p className="mt-1 text-[var(--muted)]">{detail.description}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <Stat label="difficulty" value={String(detail.difficulty)} />
        <Stat label="centrality" value={detail.centrality.toFixed(2)} />
        <Stat label="verification" value={detail.verification} />
        <Stat label="grounding" value={detail.grounding_sensitive ? "sensitive" : "no"} />
      </div>

      <div>
        <h3 className="text-xs uppercase tracking-wide text-[var(--muted)]">Edges</h3>
        <ul className="mt-1 space-y-1">
          {detail.edges.map((e) => (
            <li key={e.id} className="text-xs">
              <span className="text-[var(--accent)]">{e.type}</span>{" "}
              {e.direction === "out" ? "→" : "←"} {e.otherName}
              {e.order_index != null ? ` (#${e.order_index})` : ""}
            </li>
          ))}
          {detail.edges.length === 0 && (
            <li className="text-xs text-[var(--muted)]">none</li>
          )}
        </ul>
      </div>

      <div>
        <h3 className="text-xs uppercase tracking-wide text-[var(--muted)]">
          Items covering this node
        </h3>
        <ul className="mt-1 space-y-2">
          {detail.items.map((it) => (
            <li
              key={it.itemId}
              className="rounded-md border border-[var(--border)] bg-[var(--background)] p-2 text-xs"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{it.kind}</span>
                <span style={{ color: STATUS_COLOR[it.status] }}>{it.status}</span>
              </div>
              <div className="mt-1 text-[var(--muted)]">
                R {(it.R * 100).toFixed(0)}% · FSRS {stateNames[it.reviewState.state]} ·
                stability {it.reviewState.stability.toFixed(2)} · reps{" "}
                {it.reviewState.reps}
                {it.isDue ? " · due now" : ""}
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {it.methods.map((m) => {
                  const passed = it.methodProgress.find(
                    (p) => p.method === m
                  )?.passed;
                  return (
                    <span
                      key={m}
                      className={`rounded px-1.5 py-0.5 ${
                        passed
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-[var(--surface-2)] text-[var(--muted)]"
                      }`}
                    >
                      {m}
                      {passed ? " ✓" : ""}
                    </span>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-[var(--background)] px-2 py-1">
      <div className="text-[10px] uppercase text-[var(--muted)]">{label}</div>
      <div>{value}</div>
    </div>
  );
}
