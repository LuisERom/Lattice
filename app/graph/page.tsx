"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import cytoscape, { type Core, type NodeSingular } from "cytoscape";

interface GraphTopic {
  id: number;
  name: string;
}
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
interface GraphBridge {
  edgeId: number;
  edgeType: string;
  localNodeId: number;
  direction: "in" | "out";
  remoteNodeId: number;
  remoteNodeName: string;
  remoteTopicId: number;
  remoteTopicName: string;
}
interface GraphView {
  topics: GraphTopic[];
  topicId: number | null;
  topicName: string | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  bridges: GraphBridge[];
}

interface SavedLayout {
  nodeIds: number[];
  positions: Record<string, { x: number; y: number }>;
}

/** Stable colors for subjects (used on toggle chips and bridge stubs). */
const TOPIC_PALETTE = [
  "#a78bfa",
  "#f472b6",
  "#34d399",
  "#fbbf24",
  "#60a5fa",
  "#fb7185",
  "#2dd4bf",
  "#c084fc",
];

function topicColor(topicId: number): string {
  return TOPIC_PALETTE[(topicId - 1) % TOPIC_PALETTE.length]!;
}

function layoutStorageKey(topicId: number) {
  return `lattice:graph-layout:v1:${topicId}`;
}

function loadSavedLayout(topicId: number): SavedLayout | null {
  try {
    const raw = localStorage.getItem(layoutStorageKey(topicId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedLayout;
    if (!Array.isArray(parsed.nodeIds) || !parsed.positions) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveLayout(topicId: number, cy: Core, nodeIds: number[]) {
  const positions: Record<string, { x: number; y: number }> = {};
  for (const id of nodeIds) {
    const n = cy.$id(`n${id}`);
    if (n.empty()) continue;
    const p = n.position();
    positions[`n${id}`] = { x: p.x, y: p.y };
  }
  const payload: SavedLayout = {
    nodeIds: [...nodeIds].sort((a, b) => a - b),
    positions,
  };
  localStorage.setItem(layoutStorageKey(topicId), JSON.stringify(payload));
}

function clearSavedLayout(topicId: number) {
  localStorage.removeItem(layoutStorageKey(topicId));
}

function sameNodeSet(saved: SavedLayout, nodes: GraphNode[]): boolean {
  if (saved.nodeIds.length !== nodes.length) return false;
  const current = new Set(nodes.map((n) => n.id));
  return saved.nodeIds.every((id) => current.has(id));
}

function bridgeNodeId(edgeId: number) {
  return `x${edgeId}`;
}

const COSE_LAYOUT = {
  name: "cose" as const,
  animate: false,
  fit: true,
  padding: 30,
  nodeRepulsion: 12000,
  nodeOverlap: 20,
  idealEdgeLength: 80,
};

/**
 * After cose, push any overlapping topic nodes apart.
 * A few O(n²) passes — cheap for typical topic sizes, no physics.
 */
function separateOverlappingNodes(cy: Core, gap = 8) {
  const nodes = cy.nodes('[kind = "node"]').toArray();
  const n = nodes.length;
  if (n < 2) return;

  const radii = nodes.map((node) => (node.data("size") as number) / 2);

  for (let iter = 0; iter < 40; iter++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      const a = nodes[i]!;
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j]!;
        const pa = a.position();
        const pb = b.position();
        const minDist = radii[i]! + radii[j]! + gap;
        let dx = pb.x - pa.x;
        let dy = pb.y - pa.y;
        let dist = Math.hypot(dx, dy);
        if (dist >= minDist) continue;
        if (dist < 1e-6) {
          const angle = (i * 2.399963 + j) % (Math.PI * 2);
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          dist = 1;
        }
        const push = (minDist - dist) / 2;
        const ux = dx / dist;
        const uy = dy / dist;
        a.position({ x: pa.x - ux * push, y: pa.y - uy * push });
        b.position({ x: pb.x + ux * push, y: pb.y + uy * push });
        moved = true;
      }
    }
    if (!moved) break;
  }
}

function runTopicLayout(cy: Core) {
  const eles = cy.nodes('[kind = "node"]').union(cy.edges('[kind = "edge"]'));
  cy.layout({
    ...COSE_LAYOUT,
    eles,
  } as cytoscape.LayoutOptions).run();
  separateOverlappingNodes(cy);
  cy.fit(eles, COSE_LAYOUT.padding);
}

/** Place portal stubs around their local node; layout ignores these. */
function placeBridges(cy: Core, bridges: GraphBridge[]) {
  const byLocal = new Map<number, GraphBridge[]>();
  for (const b of bridges) {
    const list = byLocal.get(b.localNodeId) ?? [];
    list.push(b);
    byLocal.set(b.localNodeId, list);
  }

  for (const [localId, list] of byLocal) {
    const local = cy.$id(`n${localId}`);
    if (local.empty()) continue;
    const origin = local.position();
    const radius = Math.max(48, (local.data("size") as number) * 0.9 + 28);
    list.forEach((b, i) => {
      const stub = cy.$id(bridgeNodeId(b.edgeId));
      if (stub.empty()) return;
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / list.length;
      stub.position({
        x: origin.x + Math.cos(angle) * radius,
        y: origin.y + Math.sin(angle) * radius,
      });
    });
  }
}

function applyBridgeHighlight(cy: Core, highlightBridgeId: number | null) {
  cy.nodes('[kind = "bridge"]').forEach((n) => {
    n.data("highlight", n.data("edgeId") === highlightBridgeId);
  });
  cy.edges('[kind = "bridge"]').forEach((e) => {
    const stubId = e.source().data("kind") === "bridge" ? e.source().id() : e.target().id();
    const edgeId = cy.$id(stubId).data("edgeId");
    e.data("highlight", edgeId === highlightBridgeId);
  });
  if (highlightBridgeId == null) return;
  const stub = cy.$id(bridgeNodeId(highlightBridgeId));
  if (!stub.empty()) {
    cy.animate({
      center: { eles: stub },
      duration: 280,
      easing: "ease-out-cubic",
    });
  }
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
  sources: {
    sourceId: number;
    url: string;
    title: string;
    publisher: string;
    retrievedAt: string;
    quote: string;
    support: string;
  }[];
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
  return (
    <Suspense fallback={<p className="text-[var(--muted)]">Loading graph…</p>}>
      <GraphPageInner />
    </Suspense>
  );
}

function GraphPageInner() {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const highlightRef = useRef<number | null>(null);
  const bridgesRef = useRef<GraphBridge[]>([]);
  const nodeIdsRef = useRef<number[]>([]);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const topicParam = searchParams.get("topic");
  const bridgeParam = searchParams.get("bridge");
  const requestedTopicId =
    topicParam != null && Number.isFinite(Number(topicParam))
      ? Number(topicParam)
      : null;
  const highlightBridgeId =
    bridgeParam != null && Number.isFinite(Number(bridgeParam))
      ? Number(bridgeParam)
      : null;
  highlightRef.current = highlightBridgeId;

  const [topics, setTopics] = useState<GraphTopic[]>([]);
  const [topicId, setTopicId] = useState<number | null>(requestedTopicId);
  const [topicName, setTopicName] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  const [detail, setDetail] = useState<NodeDetail | null>(null);

  function navigateGraph(nextTopicId: number, bridgeId: number | null = null) {
    const params = new URLSearchParams();
    params.set("topic", String(nextTopicId));
    if (bridgeId != null) params.set("bridge", String(bridgeId));
    router.replace(`${pathname}?${params.toString()}`);
    setDetail(null);
  }

  function recalculateLayout() {
    const cy = cyRef.current;
    if (!cy || topicId == null) return;
    clearSavedLayout(topicId);
    runTopicLayout(cy);
    if (bridgesRef.current.length) placeBridges(cy, bridgesRef.current);
    saveLayout(topicId, cy, nodeIdsRef.current);
  }

  // Load / rebuild only when the topic in the URL changes — not when the
  // fetch resolves (that used to setTopicId and remount Cytoscape → flash).
  useEffect(() => {
    let cancelled = false;
    const query =
      requestedTopicId != null ? `?topicId=${requestedTopicId}` : "";

    (async () => {
      const data = (await (await fetch(`/api/graph${query}`)).json()) as GraphView;
      if (cancelled || !containerRef.current) return;

      setTopics(data.topics);
      setTopicId(data.topicId);
      setTopicName(data.topicName);

      if (data.nodes.length === 0) {
        setEmpty(true);
        cyRef.current?.destroy();
        cyRef.current = null;
        return;
      }
      setEmpty(false);

      // Parallel edges (same endpoints, different types) get a small offset
      // so straight lines don't stack on top of each other.
      const pairCounts = new Map<string, number>();
      const pairIndex = new Map<number, number>();
      for (const e of data.edges) {
        const key =
          e.source < e.target
            ? `${e.source}-${e.target}`
            : `${e.target}-${e.source}`;
        pairIndex.set(e.id, pairCounts.get(key) ?? 0);
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }

      const activeTopicId = data.topicId;
      const saved = activeTopicId != null ? loadSavedLayout(activeTopicId) : null;
      const reuseLayout =
        saved != null &&
        sameNodeSet(saved, data.nodes) &&
        data.nodes.every((n) => saved.positions[`n${n.id}`] != null);

      const elements: cytoscape.ElementDefinition[] = [
        ...data.nodes.map((n) => ({
          data: {
            id: `n${n.id}`,
            label: n.name,
            status: n.status,
            shape: n.type === "procedure" ? "round-rectangle" : "ellipse",
            due: n.due,
            size: 26 + n.centrality * 34,
            kind: "node",
          },
          ...(reuseLayout ? { position: saved.positions[`n${n.id}`] } : {}),
        })),
        ...data.edges.map((e) => {
          const key =
            e.source < e.target
              ? `${e.source}-${e.target}`
              : `${e.target}-${e.source}`;
          const count = pairCounts.get(key) ?? 1;
          const idx = pairIndex.get(e.id) ?? 0;
          const lane = count === 1 ? 0 : (idx - (count - 1) / 2) * 14;
          return {
            data: {
              id: `e${e.id}`,
              source: `n${e.source}`,
              target: `n${e.target}`,
              type: e.type,
              prereq: e.type === "prerequisite_of",
              lane,
              kind: "edge",
            },
          };
        }),
      ];

      cyRef.current?.destroy();
      const cy = cytoscape({
        container: containerRef.current,
        elements,
        style: [
          {
            selector: "node[kind = 'node']",
            style: {
              "background-color": (ele) =>
                STATUS_COLOR[ele.data("status")] ?? "#888",
              shape: (ele: NodeSingular) => ele.data("shape"),
              width: (ele: NodeSingular) => ele.data("size"),
              height: (ele: NodeSingular) => ele.data("size"),
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
            selector: "node[kind = 'node'][?due]",
            style: {
              "border-width": 2,
              "border-color": "#fb923c",
              "border-style": "solid",
            },
          },
          {
            selector: "node[kind = 'node']:selected",
            style: { "border-width": 2, "border-color": "#e6e9ef" },
          },
          {
            selector: "node[kind = 'bridge']",
            style: {
              "background-color": (ele) => ele.data("topicColor"),
              shape: "ellipse",
              width: 16,
              height: 16,
              label: "data(label)",
              color: "#e6e9ef",
              "font-size": 8,
              "text-valign": "bottom",
              "text-margin-y": 3,
              "text-max-width": "70px",
              "text-wrap": "ellipsis",
              "border-width": 2,
              "border-color": (ele) => ele.data("topicColor"),
              "border-opacity": 0.9,
            },
          },
          {
            selector: "node[kind = 'bridge'][?highlight]",
            style: {
              "border-width": 4,
              "border-color": "#f8fafc",
              width: 20,
              height: 20,
              "z-index": 999,
            },
          },
          {
            selector: "edge[kind = 'edge']",
            style: {
              width: 1.5,
              "line-color": "#3a4455",
              "target-arrow-color": "#3a4455",
              "target-arrow-shape": "triangle",
              "arrow-scale": 0.8,
              "curve-style": "segments",
              "segment-distances": (ele: any) => ele.data("lane") ?? 0,
              "segment-weights": 0.5,
              opacity: 0.6,
            },
          },
          {
            selector: "edge[kind = 'edge'][?prereq]",
            style: {
              "line-color": "#5b6b8c",
              "target-arrow-color": "#5b6b8c",
              opacity: 0.9,
            },
          },
          {
            selector: "edge[kind = 'bridge']",
            style: {
              width: 1.5,
              "line-color": (ele) => ele.data("topicColor"),
              "target-arrow-color": (ele) => ele.data("topicColor"),
              "target-arrow-shape": "triangle",
              "arrow-scale": 0.75,
              "curve-style": "straight",
              opacity: 0.85,
            },
          },
          {
            selector: "edge[kind = 'bridge'][?highlight]",
            style: {
              width: 2.5,
              opacity: 1,
            },
          },
        ],
        layout: reuseLayout
          ? { name: "preset", fit: true, padding: 30 }
          : { ...COSE_LAYOUT },
        wheelSensitivity: 2.5,
      });

      // cose alone still stacks nodes on dense topics — separate, then fit.
      if (!reuseLayout) {
        separateOverlappingNodes(cy);
        cy.fit(cy.nodes('[kind = "node"]').union(cy.edges('[kind = "edge"]')), 30);
      }

      // Portal stubs sit outside the layout; position relative to local nodes.
      if (data.bridges.length > 0) {
        const bridgeElements: cytoscape.ElementDefinition[] = [];
        for (const b of data.bridges) {
          const color = topicColor(b.remoteTopicId);
          const highlight = highlightRef.current === b.edgeId;
          bridgeElements.push({
            data: {
              id: bridgeNodeId(b.edgeId),
              label: b.remoteTopicName,
              kind: "bridge",
              topicColor: color,
              edgeId: b.edgeId,
              remoteTopicId: b.remoteTopicId,
              remoteNodeId: b.remoteNodeId,
              remoteNodeName: b.remoteNodeName,
              localNodeId: b.localNodeId,
              highlight,
            },
          });
          bridgeElements.push({
            data: {
              id: `xb${b.edgeId}`,
              source:
                b.direction === "out"
                  ? `n${b.localNodeId}`
                  : bridgeNodeId(b.edgeId),
              target:
                b.direction === "out"
                  ? bridgeNodeId(b.edgeId)
                  : `n${b.localNodeId}`,
              kind: "bridge",
              topicColor: color,
              highlight,
            },
          });
        }
        cy.add(bridgeElements);
        placeBridges(cy, data.bridges);
      }

      const nodeIds = data.nodes.map((n) => n.id);
      nodeIdsRef.current = nodeIds;
      bridgesRef.current = data.bridges;
      if (activeTopicId != null) {
        if (!reuseLayout) saveLayout(activeTopicId, cy, nodeIds);
        cy.on("dragfree", "node[kind = 'node']", (evt) => {
          const localId = Number(String(evt.target.id()).slice(1));
          const localBridges = data.bridges.filter((b) => b.localNodeId === localId);
          if (localBridges.length) placeBridges(cy, localBridges);
          saveLayout(activeTopicId, cy, nodeIds);
        });
      }

      cy.on("tap", "node[kind = 'node']", async (evt) => {
        const raw = evt.target.id() as string;
        const id = Number(raw.startsWith("n") ? raw.slice(1) : raw);
        const d = (await (await fetch(`/api/node/${id}`)).json()) as NodeDetail;
        setDetail(d);
      });

      cy.on("tap", "node[kind = 'bridge']", (evt) => {
        const remoteTopicId = evt.target.data("remoteTopicId") as number;
        const edgeId = evt.target.data("edgeId") as number;
        navigateGraph(remoteTopicId, edgeId);
      });

      cy.on("tap", (evt) => {
        if (evt.target === cy) setDetail(null);
      });

      if (highlightRef.current != null) {
        applyBridgeHighlight(cy, highlightRef.current);
      }

      cyRef.current = cy;
    })();

    return () => {
      cancelled = true;
      cyRef.current?.destroy();
      cyRef.current = null;
    };
    // navigateGraph closes over router/pathname; topic switches go through the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedTopicId]);

  // Highlight updates must not tear down the graph.
  useEffect(() => {
    if (!cyRef.current) return;
    applyBridgeHighlight(cyRef.current, highlightBridgeId);
  }, [highlightBridgeId]);

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">
            Graph
            {topicName ? (
              <span className="text-[var(--muted)]"> — {topicName}</span>
            ) : null}
          </h1>
          {topics.length > 1 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {topics.map((t) => {
                const active = t.id === topicId;
                const color = topicColor(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => navigateGraph(t.id)}
                    className="rounded-md px-3 py-1 text-xs font-medium transition-colors"
                    style={
                      active
                        ? {
                            background: `${color}33`,
                            color,
                            boxShadow: `inset 0 0 0 1px ${color}`,
                          }
                        : {
                            background: "var(--surface-2)",
                            color: "var(--muted)",
                          }
                    }
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <Legend showBridge={topics.length > 1} />
      </div>

      {empty ? (
        <p className="mt-6 text-[var(--muted)]">
          No topic imported yet. Run <code>npm run import</code> to load the seed.
        </p>
      ) : (
        <div className="mt-4 flex gap-4">
          <div className="relative min-w-0 flex-1">
            <div
              ref={containerRef}
              className="h-[72vh] rounded-lg border border-[var(--border)] bg-[var(--surface)]"
            />
            <button
              type="button"
              onClick={recalculateLayout}
              className="absolute right-3 top-3 rounded-md border border-[var(--border)] bg-[var(--surface)]/90 px-3 py-1.5 text-xs text-[var(--muted)] backdrop-blur hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
              title="Re-run layout for this topic and save the new positions"
            >
              Recalculate layout
            </button>
          </div>
          <Inspector detail={detail} />
        </div>
      )}
    </div>
  );
}

function Legend({ showBridge }: { showBridge: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 text-xs text-[var(--muted)]">
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
      <span className="flex items-center gap-1">
        <span className="inline-block h-3 w-3 rounded-full border border-[var(--muted)]" />
        concept
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-3 w-3 rounded-sm border border-[var(--muted)]" />
        procedure
      </span>
      {showBridge && (
        <span className="flex items-center gap-1">
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ background: TOPIC_PALETTE[0], boxShadow: `0 0 0 2px #f8fafc` }}
          />
          other subject
        </span>
      )}
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
        <h3 className="text-xs uppercase tracking-wide text-[var(--muted)]">Sources</h3>
        <ul className="mt-1 space-y-2">
          {detail.sources.map((s) => (
            <li
              key={`${s.sourceId}-${s.support}`}
              className="rounded-md border border-[var(--border)] bg-[var(--background)] p-2 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <a
                  className="text-[var(--accent)] underline-offset-2 hover:underline"
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {s.title}
                </a>
                <span className="text-[var(--muted)]">{s.support}</span>
              </div>
              <div className="mt-1 text-[var(--muted)]">
                {s.publisher || "source"} · {new Date(s.retrievedAt).toLocaleDateString()}
              </div>
              {s.quote ? <p className="mt-1 text-[var(--muted)]">"{s.quote}"</p> : null}
            </li>
          ))}
          {detail.sources.length === 0 && (
            <li className="text-xs text-[var(--muted)]">no sources attached</li>
          )}
        </ul>
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
