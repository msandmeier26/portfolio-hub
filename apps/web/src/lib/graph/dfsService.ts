/**
 * DFS service adapter.
 *
 * The frontend calls `getDfsService().runDfs(req)` and gets a typed response
 * back. Two backends are supported, picked at runtime:
 *
 *   1. WASM (preferred). The C++ implementation cross-compiled with Emscripten,
 *      loaded as an ES module from /services/graph-dfs/graph_service.js. The
 *      module exposes an embind-bound function:
 *
 *          // C++ side, conceptually:
 *          //   std::string runDFS(const std::string& request_json);
 *          //   EMSCRIPTEN_BINDINGS(graph) { emscripten::function("runDFS", &runDFS); }
 *          //
 *          // From JS:
 *          //   const Module = await createGraphServiceModule();
 *          //   const responseJson = Module.runDFS(requestJson);
 *
 *   2. JS fallback. The bundled TypeScript reference DFS (see lib/graph/dfs.ts)
 *      runs in-process when the WASM module isn't available. Same JSON shape.
 *      No network round-trip in either path — this app is fully client-side.
 */

import {
  type DfsRequest,
  type DfsResponse,
  DfsResponseSchema,
} from "./types";
import { runDfs as runDfsLocal } from "./dfs";

type GraphServiceModule = {
  runDFS: (requestJson: string) => string;
};

type ModuleFactory = (overrides?: Record<string, unknown>) => Promise<GraphServiceModule>;

const WASM_LOADER_URL = "/services/graph-dfs/graph_service.js";

export type Backend = "wasm" | "fallback";

export type DfsService = {
  backend: Backend;
  runDfs(req: DfsRequest): Promise<DfsResponse>;
};

let cached: Promise<DfsService> | null = null;

async function tryLoadWasm(): Promise<GraphServiceModule | null> {
  if (typeof window === "undefined") return null;

  // HEAD probe so a missing module doesn't show up as a noisy 404 error in
  // the network panel. Cloudflare/Next both serve HEAD for static assets.
  try {
    const probe = await fetch(WASM_LOADER_URL, { method: "HEAD" });
    if (!probe.ok) return null;
  } catch {
    return null;
  }

  // Use a Function-constructed dynamic import so the bundler doesn't try to
  // analyze, follow, or rewrite the URL — it's a runtime asset shipped under
  // /public/, not part of the JS module graph.
  const dynamicImport = new Function("u", "return import(u)") as (
    u: string,
  ) => Promise<{ default: ModuleFactory }>;

  try {
    const mod = await dynamicImport(WASM_LOADER_URL);
    const factory = mod.default;
    if (typeof factory !== "function") return null;
    const instance = await factory();
    if (typeof instance.runDFS !== "function") return null;
    return instance;
  } catch {
    return null;
  }
}

export function getDfsService(): Promise<DfsService> {
  if (cached) return cached;
  cached = (async (): Promise<DfsService> => {
    const wasm = await tryLoadWasm();
    if (wasm) {
      return {
        backend: "wasm",
        async runDfs(req) {
          const out = wasm.runDFS(JSON.stringify(req));
          let parsed: unknown;
          try {
            parsed = JSON.parse(out);
          } catch (err) {
            throw new Error(
              `WASM DFS returned non-JSON: ${(err as Error).message}`,
            );
          }
          if (
            parsed &&
            typeof parsed === "object" &&
            "message" in parsed &&
            typeof (parsed as { message: unknown }).message === "string"
          ) {
            throw new Error((parsed as { message: string }).message);
          }
          const valid = DfsResponseSchema.safeParse(parsed);
          if (!valid.success) {
            throw new Error(
              `WASM DFS response failed validation: ${valid.error.message}`,
            );
          }
          return valid.data;
        },
      };
    }
    return {
      backend: "fallback",
      async runDfs(req) {
        return runDfsLocal(req);
      },
    };
  })();
  return cached;
}

export function resetDfsServiceCache() {
  cached = null;
}
