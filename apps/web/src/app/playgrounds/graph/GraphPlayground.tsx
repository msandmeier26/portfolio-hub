"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { DfsResponse, Edge } from "@/lib/graph/types";
import { getDfsService, type Backend } from "@/lib/graph/dfsService";
import {
  BUILTIN_PROFILES,
  loadCustomProfiles,
  saveCustomProfiles,
  loadLastProfileId,
  saveLastProfileId,
  newProfileId,
  normalize,
  type RandomGraphProfile,
} from "@/lib/graph/profiles";

type Vertex = { id: string; x: number; y: number };
type Tool = "select" | "add-vertex" | "add-edge";

const VIEW_W = 900;
const VIEW_H = 560;
const VERTEX_R = 22;

function nextLabel(existing: string[]): string {
  const used = new Set(existing);
  for (let i = 0; i < 26; i++) {
    const ch = String.fromCharCode(65 + i);
    if (!used.has(ch)) return ch;
  }
  let n = 27;
  while (used.has(`V${n}`)) n++;
  return `V${n}`;
}

function randomGraph(profile: RandomGraphProfile): { vertices: Vertex[]; edges: Edge[] } {
  const norm = normalize(profile);
  const span = norm.vertexMax - norm.vertexMin;
  const n = norm.vertexMin + (span > 0 ? Math.floor(Math.random() * (span + 1)) : 0);
  const vertices: Vertex[] = [];
  if (n === 0) return { vertices, edges: [] };

  const cx = VIEW_W / 2;
  const cy = VIEW_H / 2;
  const radius = Math.min(VIEW_W, VIEW_H) * 0.38;
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    vertices.push({
      id: nextLabel(vertices.map((v) => v.id)),
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  }
  const edges: Edge[] = [];
  const seen = new Set<string>();
  const target = Math.max(0, Math.round(n * norm.edgeFactor));
  let guard = 0;
  while (edges.length < target && guard++ < target * 10 + 50) {
    const a = vertices[Math.floor(Math.random() * n)];
    const b = vertices[Math.floor(Math.random() * n)];
    if (!norm.allowSelfLoops && a.id === b.id) continue;
    const key = `${a.id}->${b.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ from: a.id, to: b.id, weight: 1 });
  }
  return { vertices, edges };
}

export default function GraphPlayground() {
  const [vertices, setVertices] = useState<Vertex[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [directed, setDirected] = useState(true);
  const [tool, setTool] = useState<Tool>("add-vertex");
  const [edgeFromId, setEdgeFromId] = useState<string | null>(null);
  const [startVertex, setStartVertex] = useState<string>("");

  const [dfsResult, setDfsResult] = useState<DfsResponse | null>(null);
  const [dfsLoading, setDfsLoading] = useState(false);
  const [dfsError, setDfsError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(700);
  const [backend, setBackend] = useState<Backend | null>(null);

  const [hoverEdgeIdx, setHoverEdgeIdx] = useState<number | null>(null);
  const [menuEdgeIdx, setMenuEdgeIdx] = useState<number | null>(null);
  const [showJson, setShowJson] = useState(false);

  // Random-graph profile state. Custom profiles are loaded from localStorage on
  // mount; the editor draft is what the Random button actually generates with.
  const [customProfiles, setCustomProfiles] = useState<RandomGraphProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>("builtin:default");
  const defaultDraft = BUILTIN_PROFILES.find((p) => p.id === "builtin:default")!;
  const [draft, setDraft] = useState<RandomGraphProfile>(defaultDraft);
  const [saveAsName, setSaveAsName] = useState("");

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number; moved: boolean } | null>(
    null,
  );
  const hoverShowTimer = useRef<number | null>(null);
  const hoverHideTimer = useRef<number | null>(null);

  // Hydrate profiles from localStorage and seed a starter graph on first mount.
  // Both must be deferred to an effect: localStorage isn't available during SSR,
  // and Math.random() would diverge between SSR and client.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    const custom = loadCustomProfiles();
    setCustomProfiles(custom);

    const lastId = loadLastProfileId();
    const all = [...BUILTIN_PROFILES, ...custom];
    const initial = all.find((p) => p.id === lastId) ?? defaultDraft;
    setActiveProfileId(initial.id);
    setDraft(initial);

    const seed = randomGraph(initial);
    setVertices(seed.vertices);
    setEdges(seed.edges);
    setStartVertex(seed.vertices[0]?.id ?? "");
    /* eslint-enable react-hooks/set-state-in-effect */
    // defaultDraft is a stable module-scope reference; safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Probe the DFS backend on mount so we can show "WASM" vs "JS fallback".
  useEffect(() => {
    let cancelled = false;
    getDfsService().then((svc) => {
      if (!cancelled) setBackend(svc.backend);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Derived: the start vertex actually used (falls back when the user-selected
  // one no longer exists, e.g. after Clear or removing a vertex).
  const effectiveStartVertex = useMemo(() => {
    if (vertices.length === 0) return "";
    if (vertices.some((v) => v.id === startVertex)) return startVertex;
    return vertices[0].id;
  }, [vertices, startVertex]);

  // Animation timer. We don't stop `playing` when we reach the end —
  // the play button just relabels to "Replay" and a click resets step to 0.
  useEffect(() => {
    if (!playing || !dfsResult) return;
    if (step >= dfsResult.edgeStepsFromStart.length) return;
    const t = setTimeout(() => setStep((s) => s + 1), speedMs);
    return () => clearTimeout(t);
  }, [playing, step, speedMs, dfsResult]);

  const svgPointFromEvent = useCallback((evt: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  }, []);

  const handleBackgroundClick = (evt: React.MouseEvent<SVGSVGElement>) => {
    if (tool !== "add-vertex") return;
    if ((evt.target as SVGElement).tagName !== "svg" &&
        (evt.target as SVGElement).getAttribute("data-bg") !== "true") {
      return;
    }
    const { x, y } = svgPointFromEvent(evt);
    setVertices((vs) => [...vs, { id: nextLabel(vs.map((v) => v.id)), x, y }]);
  };

  const handleVertexPointerDown = (vertexId: string) => (evt: React.PointerEvent<SVGGElement>) => {
    evt.stopPropagation();
    if (tool === "add-edge") {
      if (edgeFromId === null) {
        setEdgeFromId(vertexId);
      } else if (edgeFromId !== vertexId) {
        setEdges((es) => [...es, { from: edgeFromId, to: vertexId, weight: 1 }]);
        setEdgeFromId(null);
      } else {
        setEdgeFromId(null);
      }
      return;
    }
    if (tool === "select") {
      const v = vertices.find((v) => v.id === vertexId);
      if (!v) return;
      const { x, y } = svgPointFromEvent(evt);
      dragRef.current = { id: vertexId, offsetX: x - v.x, offsetY: y - v.y, moved: false };
      (evt.currentTarget as Element).setPointerCapture(evt.pointerId);
    }
  };

  const handlePointerMove = (evt: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const { x, y } = svgPointFromEvent(evt);
    drag.moved = true;
    setVertices((vs) =>
      vs.map((v) => (v.id === drag.id ? { ...v, x: x - drag.offsetX, y: y - drag.offsetY } : v)),
    );
  };

  const handlePointerUp = () => {
    dragRef.current = null;
  };

  const removeVertex = (id: string) => {
    setVertices((vs) => vs.filter((v) => v.id !== id));
    setEdges((es) => es.filter((e) => e.from !== id && e.to !== id));
    setMenuEdgeIdx(null);
    setHoverEdgeIdx(null);
  };

  // --- Edge hover menu ---
  // Cancel any pending timers when the component unmounts.
  useEffect(() => {
    return () => {
      if (hoverShowTimer.current !== null) window.clearTimeout(hoverShowTimer.current);
      if (hoverHideTimer.current !== null) window.clearTimeout(hoverHideTimer.current);
    };
  }, []);

  const handleEdgeEnter = (idx: number) => {
    if (hoverHideTimer.current !== null) {
      window.clearTimeout(hoverHideTimer.current);
      hoverHideTimer.current = null;
    }
    setHoverEdgeIdx(idx);
    if (hoverShowTimer.current !== null) window.clearTimeout(hoverShowTimer.current);
    hoverShowTimer.current = window.setTimeout(() => {
      setMenuEdgeIdx(idx);
      hoverShowTimer.current = null;
    }, 1000);
  };

  const handleEdgeLeave = () => {
    if (hoverShowTimer.current !== null) {
      window.clearTimeout(hoverShowTimer.current);
      hoverShowTimer.current = null;
    }
    setHoverEdgeIdx(null);
    // Small grace window so the pointer can travel from edge to menu without losing focus.
    if (hoverHideTimer.current !== null) window.clearTimeout(hoverHideTimer.current);
    hoverHideTimer.current = window.setTimeout(() => {
      setMenuEdgeIdx(null);
      hoverHideTimer.current = null;
    }, 250);
  };

  const handleMenuEnter = () => {
    if (hoverHideTimer.current !== null) {
      window.clearTimeout(hoverHideTimer.current);
      hoverHideTimer.current = null;
    }
  };

  const handleMenuLeave = () => {
    setMenuEdgeIdx(null);
  };

  const removeEdge = (idx: number) => {
    setEdges((es) => es.filter((_, i) => i !== idx));
    setMenuEdgeIdx(null);
    setHoverEdgeIdx(null);
    setDfsResult(null);
    setStep(0);
    setPlaying(false);
  };

  const reverseEdge = (idx: number) => {
    setEdges((es) =>
      es.map((e, i) => (i === idx ? { from: e.to, to: e.from, weight: e.weight } : e)),
    );
    setMenuEdgeIdx(null);
    setHoverEdgeIdx(null);
    setDfsResult(null);
    setStep(0);
    setPlaying(false);
  };

  const clearAll = () => {
    setVertices([]);
    setEdges([]);
    setDfsResult(null);
    setStep(0);
    setPlaying(false);
    setEdgeFromId(null);
  };

  const generateRandom = () => {
    const seed = randomGraph(draft);
    setVertices(seed.vertices);
    setEdges(seed.edges);
    setDfsResult(null);
    setStep(0);
    setPlaying(false);
    setEdgeFromId(null);
  };

  // --- Profile management ---
  const allProfiles = useMemo(
    () => [...BUILTIN_PROFILES, ...customProfiles],
    [customProfiles],
  );

  const activeProfile = useMemo(
    () => allProfiles.find((p) => p.id === activeProfileId) ?? defaultDraft,
    [allProfiles, activeProfileId, defaultDraft],
  );

  const isDirty = useMemo(() => {
    const a = activeProfile;
    const b = normalize(draft);
    return (
      a.vertexMin !== b.vertexMin ||
      a.vertexMax !== b.vertexMax ||
      a.edgeFactor !== b.edgeFactor ||
      a.allowSelfLoops !== b.allowSelfLoops
    );
  }, [activeProfile, draft]);

  const selectProfile = (id: string) => {
    const p = allProfiles.find((q) => q.id === id);
    if (!p) return;
    setActiveProfileId(id);
    setDraft(p);
    saveLastProfileId(id);
  };

  const saveAsProfile = () => {
    const name = saveAsName.trim();
    if (!name) return;
    const created: RandomGraphProfile = {
      ...normalize(draft),
      id: newProfileId(),
      name,
      builtIn: false,
    };
    const next = [...customProfiles, created];
    setCustomProfiles(next);
    saveCustomProfiles(next);
    setActiveProfileId(created.id);
    setDraft(created);
    saveLastProfileId(created.id);
    setSaveAsName("");
  };

  const updateActiveProfile = () => {
    if (activeProfile.builtIn) return;
    const updated: RandomGraphProfile = {
      ...normalize(draft),
      id: activeProfile.id,
      name: activeProfile.name,
      builtIn: false,
    };
    const next = customProfiles.map((p) => (p.id === updated.id ? updated : p));
    setCustomProfiles(next);
    saveCustomProfiles(next);
    setDraft(updated);
  };

  const deleteActiveProfile = () => {
    if (activeProfile.builtIn) return;
    const next = customProfiles.filter((p) => p.id !== activeProfile.id);
    setCustomProfiles(next);
    saveCustomProfiles(next);
    setActiveProfileId(defaultDraft.id);
    setDraft(defaultDraft);
    saveLastProfileId(defaultDraft.id);
  };

  const runDfs = async () => {
    setDfsLoading(true);
    setDfsError(null);
    setDfsResult(null);
    setStep(0);
    setPlaying(false);
    try {
      const svc = await getDfsService();
      setBackend(svc.backend);
      const result = await svc.runDfs({
        directed,
        vertices: vertices.map((v) => v.id),
        edges,
        startVertex: effectiveStartVertex || undefined,
      });
      setDfsResult(result);
      setPlaying(true);
    } catch (err) {
      setDfsError((err as Error).message);
    } finally {
      setDfsLoading(false);
    }
  };

  // Derived state for animation highlighting
  const traversedEdges = useMemo(() => {
    if (!dfsResult) return new Set<string>();
    const set = new Set<string>();
    for (let i = 0; i < step; i++) {
      const e = dfsResult.edgeStepsFromStart[i];
      if (e) set.add(`${e.from}->${e.to}`);
    }
    return set;
  }, [dfsResult, step]);

  const visitedVertices = useMemo(() => {
    if (!dfsResult) return new Set<string>();
    const visited = new Set<string>();
    if (dfsResult.vertexStepsFromStart.length > 0) {
      visited.add(dfsResult.vertexStepsFromStart[0]);
    }
    for (let i = 0; i < step; i++) {
      const e = dfsResult.edgeStepsFromStart[i];
      if (e) visited.add(e.to);
    }
    return visited;
  }, [dfsResult, step]);

  const currentEdge = dfsResult?.edgeStepsFromStart[step - 1] ?? null;
  const totalSteps = dfsResult?.edgeStepsFromStart.length ?? 0;

  const vertexById = useMemo(() => {
    const m = new Map<string, Vertex>();
    for (const v of vertices) m.set(v.id, v);
    return m;
  }, [vertices]);

  // The exact JSON that gets sent to the DFS service. Surfaced in the sidebar
  // so the C++ author can see the contract live.
  const requestPayload = useMemo(
    () => ({
      directed,
      vertices: vertices.map((v) => v.id),
      edges,
      ...(effectiveStartVertex ? { startVertex: effectiveStartVertex } : {}),
    }),
    [directed, vertices, edges, effectiveStartVertex],
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-zinc-50 dark:bg-black text-zinc-900 dark:text-zinc-100">
      <header className="border-b border-zinc-200 dark:border-zinc-800 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-baseline justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">Graph Playground</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              Build a graph, then run an animated DFS from any vertex.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <BackendBadge backend={backend} />
            <Link
              href="/"
              className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              ← Home
            </Link>
          </div>
        </div>
      </header>

      <div className="flex-1 max-w-6xl w-full mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 min-h-0">
        <div className="flex flex-col gap-3 min-w-0">
          <Toolbar
            tool={tool}
            setTool={setTool}
            directed={directed}
            setDirected={setDirected}
            onRandom={generateRandom}
            onClear={clearAll}
            edgeFromId={edgeFromId}
          />

          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              className="w-full h-auto select-none touch-none"
              onClick={handleBackgroundClick}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              style={{ cursor: tool === "add-vertex" ? "copy" : tool === "add-edge" ? "crosshair" : "default" }}
            >
              <rect data-bg="true" x={0} y={0} width={VIEW_W} height={VIEW_H} fill="transparent" />
              {directed && (
                <defs>
                  <marker
                    id="arrow"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
                  </marker>
                  <marker
                    id="arrow-active"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#10b981" />
                  </marker>
                </defs>
              )}

              {edges.map((e, i) => {
                const a = vertexById.get(e.from);
                const b = vertexById.get(e.to);
                if (!a || !b) return null;
                const key = `${e.from}->${e.to}`;
                const isTraversed = traversedEdges.has(key);
                const isCurrent =
                  currentEdge &&
                  currentEdge.from === e.from &&
                  currentEdge.to === e.to &&
                  step > 0 &&
                  traversedEdges.has(key);
                const isHovered = hoverEdgeIdx === i || menuEdgeIdx === i;
                const { x1, y1, x2, y2 } = trimToCircle(a, b, VERTEX_R + 2);
                const stroke = isCurrent
                  ? "#f59e0b"
                  : isTraversed
                  ? "#10b981"
                  : isHovered
                  ? "#3b82f6"
                  : "#a1a1aa";
                const width = isCurrent ? 4 : isTraversed ? 3 : isHovered ? 3 : 2;
                return (
                  <g
                    key={`${key}-${i}`}
                    onPointerEnter={() => handleEdgeEnter(i)}
                    onPointerLeave={handleEdgeLeave}
                  >
                    <line
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke={stroke}
                      strokeWidth={width}
                      style={{ color: stroke, pointerEvents: "none" }}
                      markerEnd={
                        directed
                          ? isTraversed || isCurrent
                            ? "url(#arrow-active)"
                            : "url(#arrow)"
                          : undefined
                      }
                    />
                    <line
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke="transparent"
                      strokeWidth={16}
                      style={{ cursor: "pointer", pointerEvents: "stroke" }}
                    />
                  </g>
                );
              })}

              {menuEdgeIdx !== null && (() => {
                const e = edges[menuEdgeIdx];
                if (!e) return null;
                const a = vertexById.get(e.from);
                const b = vertexById.get(e.to);
                if (!a || !b) return null;
                const mx = (a.x + b.x) / 2;
                const my = (a.y + b.y) / 2;
                const menuW = directed ? 168 : 88;
                const menuH = 32;
                const x = Math.max(4, Math.min(VIEW_W - menuW - 4, mx - menuW / 2));
                const y = Math.max(4, Math.min(VIEW_H - menuH - 4, my - menuH - 10));
                return (
                  <foreignObject x={x} y={y} width={menuW} height={menuH} style={{ overflow: "visible" }}>
                    <div
                      onPointerEnter={handleMenuEnter}
                      onPointerLeave={handleMenuLeave}
                      className="flex items-center gap-1 h-full bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded shadow-md px-1"
                    >
                      <button
                        type="button"
                        onClick={() => removeEdge(menuEdgeIdx)}
                        className="text-xs px-2 py-1 rounded text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                      >
                        Remove
                      </button>
                      {directed && (
                        <button
                          type="button"
                          onClick={() => reverseEdge(menuEdgeIdx)}
                          className="text-xs px-2 py-1 rounded text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                          Reverse {e.from}↔{e.to}
                        </button>
                      )}
                    </div>
                  </foreignObject>
                );
              })()}

              {vertices.map((v) => {
                const isStart = v.id === effectiveStartVertex;
                const isVisited = visitedVertices.has(v.id);
                const isFromSel = edgeFromId === v.id;
                const fill = isVisited
                  ? "#10b981"
                  : isStart
                  ? "#3b82f6"
                  : isFromSel
                  ? "#f59e0b"
                  : "#ffffff";
                const textColor = isVisited || isStart || isFromSel ? "#ffffff" : "#18181b";
                return (
                  <g
                    key={v.id}
                    onPointerDown={handleVertexPointerDown(v.id)}
                    onDoubleClick={() => removeVertex(v.id)}
                    style={{
                      cursor: tool === "select" ? "grab" : tool === "add-edge" ? "pointer" : "default",
                    }}
                  >
                    <circle
                      cx={v.x}
                      cy={v.y}
                      r={VERTEX_R}
                      fill={fill}
                      stroke="#27272a"
                      strokeWidth={2}
                    />
                    <text
                      x={v.x}
                      y={v.y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={14}
                      fontWeight={600}
                      fill={textColor}
                      style={{ pointerEvents: "none", userSelect: "none" }}
                    >
                      {v.id}
                    </text>
                  </g>
                );
              })}
            </svg>
            <div className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400 border-t border-zinc-200 dark:border-zinc-800">
              <span className="mr-3">{vertices.length} vertices</span>
              <span className="mr-3">{edges.length} edges</span>
              <span>
                {tool === "add-vertex" && "Click empty space to add a vertex. Hover an edge for 1s to remove or reverse it."}
                {tool === "add-edge" &&
                  (edgeFromId
                    ? `Click another vertex to connect from ${edgeFromId}.`
                    : "Click a vertex to start an edge.")}
                {tool === "select" && "Drag vertices to move them. Double-click a vertex to remove. Hover an edge for 1s for edit options."}
              </span>
            </div>
          </div>
        </div>

        <aside className="flex flex-col gap-4 min-w-0">
          <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
            <h2 className="text-sm font-semibold mb-3">Run DFS</h2>
            <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
              Start vertex
            </label>
            <select
              value={effectiveStartVertex}
              onChange={(e) => setStartVertex(e.target.value)}
              className="w-full text-sm rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 mb-3"
            >
              {vertices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.id}
                </option>
              ))}
            </select>
            <button
              onClick={runDfs}
              disabled={dfsLoading || vertices.length === 0}
              className="w-full text-sm rounded bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 py-2 font-medium disabled:opacity-50"
            >
              {dfsLoading ? "Running…" : "Run DFS"}
            </button>
            {dfsError && (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">{dfsError}</p>
            )}
          </section>

          {dfsResult && (
            <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
              <h2 className="text-sm font-semibold mb-3">Animation</h2>
              <div className="flex items-center gap-2 mb-3">
                <button
                  onClick={() => {
                    if (step >= totalSteps) {
                      setStep(0);
                      setPlaying(true);
                    } else {
                      setPlaying((p) => !p);
                    }
                  }}
                  className="text-sm rounded bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-3 py-1.5"
                >
                  {step >= totalSteps ? "Replay" : playing ? "Pause" : "Play"}
                </button>
                <button
                  onClick={() => {
                    setPlaying(false);
                    setStep((s) => Math.max(0, s - 1));
                  }}
                  className="text-sm rounded border border-zinc-300 dark:border-zinc-700 px-3 py-1.5"
                >
                  ◀
                </button>
                <button
                  onClick={() => {
                    setPlaying(false);
                    setStep((s) => Math.min(totalSteps, s + 1));
                  }}
                  className="text-sm rounded border border-zinc-300 dark:border-zinc-700 px-3 py-1.5"
                >
                  ▶
                </button>
                <button
                  onClick={() => {
                    setPlaying(false);
                    setStep(0);
                  }}
                  className="text-sm rounded border border-zinc-300 dark:border-zinc-700 px-3 py-1.5"
                >
                  Reset
                </button>
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
                Step {step} / {totalSteps}
                {currentEdge && step > 0 && (
                  <span className="ml-2 text-zinc-700 dark:text-zinc-300">
                    {currentEdge.from} → {currentEdge.to}
                  </span>
                )}
              </div>
              <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                Speed: {speedMs}ms / step
              </label>
              <input
                type="range"
                min={120}
                max={1600}
                step={40}
                value={speedMs}
                onChange={(e) => setSpeedMs(Number(e.target.value))}
                className="w-full"
              />
              <div className="mt-3 text-xs">
                <div className="text-zinc-500 dark:text-zinc-400 mb-1">
                  Vertex order from {effectiveStartVertex}:
                </div>
                <div className="font-mono break-all">
                  [{dfsResult.vertexStepsFromStart.join(", ")}]
                </div>
                <div className="text-zinc-500 dark:text-zinc-400 mt-2 mb-1">
                  Global visit order:
                </div>
                <div className="font-mono break-all">
                  [{dfsResult.visitOrder.join(", ")}]
                </div>
              </div>
            </section>
          )}

          <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
            <h2 className="text-sm font-semibold mb-3">Random graph</h2>
            <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
              Profile {isDirty && <span className="text-amber-600 dark:text-amber-400">(modified)</span>}
            </label>
            <select
              value={activeProfileId}
              onChange={(e) => selectProfile(e.target.value)}
              className="w-full text-sm rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 mb-3"
            >
              <optgroup label="Built-in">
                {BUILTIN_PROFILES.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
              {customProfiles.length > 0 && (
                <optgroup label="Saved">
                  {customProfiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </optgroup>
              )}
            </select>

            <div className="grid grid-cols-2 gap-2 mb-3">
              <div>
                <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">Min vertices</label>
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={draft.vertexMin}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, vertexMin: Number(e.target.value) || 0 }))
                  }
                  className="w-full text-sm rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">Max vertices</label>
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={draft.vertexMax}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, vertexMax: Number(e.target.value) || 0 }))
                  }
                  className="w-full text-sm rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5"
                />
              </div>
            </div>

            <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
              Edge density: {draft.edgeFactor.toFixed(2)} × |V|
            </label>
            <input
              type="range"
              min={0}
              max={5}
              step={0.1}
              value={draft.edgeFactor}
              onChange={(e) =>
                setDraft((d) => ({ ...d, edgeFactor: Number(e.target.value) }))
              }
              className="w-full mb-3"
            />

            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 mb-3">
              <input
                type="checkbox"
                checked={draft.allowSelfLoops}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, allowSelfLoops: e.target.checked }))
                }
              />
              Allow self-loops
            </label>

            <div className="flex flex-col gap-2">
              <button
                onClick={generateRandom}
                className="w-full text-sm rounded bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 py-2 font-medium"
              >
                Generate
              </button>

              {!activeProfile.builtIn && isDirty && (
                <button
                  onClick={updateActiveProfile}
                  className="w-full text-sm rounded border border-zinc-300 dark:border-zinc-700 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  Update &quot;{activeProfile.name}&quot;
                </button>
              )}

              {!activeProfile.builtIn && (
                <button
                  onClick={deleteActiveProfile}
                  className="w-full text-sm rounded border border-red-300 dark:border-red-900 text-red-600 dark:text-red-400 py-1.5 hover:bg-red-50 dark:hover:bg-red-950/40"
                >
                  Delete &quot;{activeProfile.name}&quot;
                </button>
              )}

              <div className="flex gap-2 mt-1">
                <input
                  type="text"
                  placeholder="New profile name…"
                  value={saveAsName}
                  onChange={(e) => setSaveAsName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveAsProfile();
                  }}
                  className="flex-1 text-sm rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 min-w-0"
                />
                <button
                  onClick={saveAsProfile}
                  disabled={!saveAsName.trim()}
                  className="text-sm rounded border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Save as
                </button>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold">JSON contract</h2>
              <button
                onClick={() => setShowJson((s) => !s)}
                className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                {showJson ? "Hide" : "Show"}
              </button>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              The exact payload your C++ DFS function consumes and produces. Live-updates with the
              graph above.
            </p>
            {showJson && (
              <div className="mt-3 space-y-3">
                <JsonBlock label="Request" payload={requestPayload} />
                {dfsResult ? (
                  <JsonBlock label="Response (last run)" payload={dfsResult} />
                ) : (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 italic">
                    Run DFS to see the response shape.
                  </p>
                )}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 text-xs text-zinc-600 dark:text-zinc-400">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
              Service backend
            </h2>
            {backend === "wasm" ? (
              <p>
                The C++ DFS service is running on this device as a WebAssembly module.
                No network round-trip — your graph never leaves the browser.
              </p>
            ) : backend === "fallback" ? (
              <p>
                No WASM module found at{" "}
                <code className="font-mono">/services/graph-dfs/graph_service.js</code>. Falling
                back to the bundled TypeScript reference DFS, also running locally in this tab.
                Drop a built Emscripten artifact into{" "}
                <code className="font-mono">apps/web/public/services/graph-dfs/</code> to take over.
              </p>
            ) : (
              <p>Probing backend…</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function Toolbar(props: {
  tool: Tool;
  setTool: (t: Tool) => void;
  directed: boolean;
  setDirected: (d: boolean) => void;
  onRandom: () => void;
  onClear: () => void;
  edgeFromId: string | null;
}) {
  const { tool, setTool, directed, setDirected, onRandom, onClear } = props;
  const btn = (active: boolean) =>
    `text-sm rounded px-3 py-1.5 border transition-colors ${
      active
        ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-zinc-900 dark:border-zinc-100"
        : "bg-white dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-900"
    }`;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2">
      <div className="flex gap-1">
        <button onClick={() => setTool("select")} className={btn(tool === "select")}>
          Select / drag
        </button>
        <button onClick={() => setTool("add-vertex")} className={btn(tool === "add-vertex")}>
          Add vertex
        </button>
        <button onClick={() => setTool("add-edge")} className={btn(tool === "add-edge")}>
          Add edge
        </button>
      </div>
      <div className="h-6 w-px bg-zinc-200 dark:bg-zinc-800 mx-1" />
      <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
        <input
          type="checkbox"
          checked={directed}
          onChange={(e) => setDirected(e.target.checked)}
        />
        Directed
      </label>
      <div className="h-6 w-px bg-zinc-200 dark:bg-zinc-800 mx-1" />
      <button
        onClick={onRandom}
        className="text-sm rounded px-3 py-1.5 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-900"
      >
        Random graph
      </button>
      <button
        onClick={onClear}
        className="text-sm rounded px-3 py-1.5 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-900"
      >
        Clear
      </button>
    </div>
  );
}

function BackendBadge({ backend }: { backend: Backend | null }) {
  if (backend === null) {
    return (
      <span className="text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-800 text-zinc-500">
        Probing…
      </span>
    );
  }
  if (backend === "wasm") {
    return (
      <span
        title="The C++ DFS service is loaded as a WebAssembly module and runs on this device."
        className="text-xs px-2 py-1 rounded border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300"
      >
        WASM · client-side
      </span>
    );
  }
  return (
    <span
      title="WASM module not found. Falling back to the bundled TypeScript reference DFS, also running in this tab."
      className="text-xs px-2 py-1 rounded border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300"
    >
      JS fallback
    </span>
  );
}

function JsonBlock({ label, payload }: { label: string; payload: unknown }) {
  const [copied, setCopied] = useState(false);
  const text = JSON.stringify(payload, null, 2);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard API can be denied; ignore.
    }
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
        <button
          onClick={copy}
          className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="text-[11px] leading-relaxed font-mono bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded p-2 max-h-64 overflow-auto whitespace-pre">
        {text}
      </pre>
    </div>
  );
}

function trimToCircle(a: Vertex, b: Vertex, r: number) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  return {
    x1: a.x + ux * r,
    y1: a.y + uy * r,
    x2: b.x - ux * r,
    y2: b.y - uy * r,
  };
}
