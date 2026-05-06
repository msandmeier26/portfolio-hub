import type { DfsRequest, DfsResponse, Edge } from "./types";

type AdjList = Map<string, Edge[]>;

function buildAdjacency(req: DfsRequest): AdjList {
  const adj: AdjList = new Map();
  for (const v of req.vertices) adj.set(v, []);

  for (const e of req.edges) {
    if (!adj.has(e.from) || !adj.has(e.to)) {
      throw new Error(`Edge ${e.from} -> ${e.to} references unknown vertex`);
    }
    adj.get(e.from)!.push(e);
    if (!req.directed) {
      adj.get(e.to)!.push({ from: e.to, to: e.from, weight: e.weight });
    }
  }
  return adj;
}

function dfsFrom(
  start: string,
  adj: AdjList,
  visited: Set<string>,
): { vertices: string[]; edges: Edge[] } {
  const vertices: string[] = [];
  const edges: Edge[] = [];

  const walk = (u: string) => {
    visited.add(u);
    vertices.push(u);
    for (const edge of adj.get(u) ?? []) {
      if (!visited.has(edge.to)) {
        edges.push({ from: edge.from, to: edge.to, weight: edge.weight });
        walk(edge.to);
      }
    }
  };

  walk(start);
  return { vertices, edges };
}

export function runDfs(req: DfsRequest): DfsResponse {
  const adj = buildAdjacency(req);

  const vertexTraces: Record<string, string[]> = {};
  const edgeTraces: Record<string, Edge[]> = {};
  for (const v of req.vertices) {
    const r = dfsFrom(v, adj, new Set<string>());
    vertexTraces[v] = r.vertices;
    edgeTraces[v] = r.edges;
  }

  const visitOrder: string[] = [];
  const visitedGlobal = new Set<string>();
  for (const v of req.vertices) {
    if (visitedGlobal.has(v)) continue;
    const r = dfsFrom(v, adj, visitedGlobal);
    visitOrder.push(...r.vertices);
  }

  const start =
    req.startVertex && req.vertices.includes(req.startVertex)
      ? req.startVertex
      : req.vertices[0];

  const fromStart =
    start === undefined
      ? { vertices: [], edges: [] }
      : dfsFrom(start, adj, new Set<string>());

  return {
    edgeStepsFromStart: fromStart.edges,
    vertexStepsFromStart: fromStart.vertices,
    vertexTraces,
    edgeTraces,
    visitOrder,
  };
}
