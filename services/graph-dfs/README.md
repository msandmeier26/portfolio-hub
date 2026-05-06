# graph-dfs — JSON contract

The Graph DFS service consumes a graph as JSON and returns a JSON object containing
both the per-vertex DFS traces and the ordered edge sequence the frontend animates.

The service is shipped as a WebAssembly module and runs entirely client-side —
no servers, no network round-trip after the page is loaded. The OpenAPI version
of this JSON contract lives at [`openapi/graph-dfs.yaml`](../../openapi/graph-dfs.yaml)
for reference.

## Request

```jsonc
{
  "directed": true,                // bool — if false, every edge is treated as bidirectional
  "vertices": ["G", "F", "E", "B", "D", "C", "A"],   // insertion order matters, see below
  "edges": [
    { "from": "F", "to": "G", "weight": 1 },         // weight is optional
    { "from": "E", "to": "F" },
    { "from": "B", "to": "C" },
    { "from": "B", "to": "F" },
    { "from": "D", "to": "E" },
    { "from": "C", "to": "A" },
    { "from": "C", "to": "D" },
    { "from": "A", "to": "B" }
  ],
  "startVertex": "A"               // optional; defaults to vertices[0] when omitted or unknown
}
```

### Field semantics

| Field         | Type                    | Notes                                                                                                  |
|---------------|-------------------------|--------------------------------------------------------------------------------------------------------|
| `directed`    | bool                    | Required.                                                                                              |
| `vertices`    | string[]                | Required, may be empty. **Insertion order is the tie-break for neighbour iteration and `visitOrder`.** |
| `edges`       | Edge[]                  | Required, may be empty. Edges may reference vertices in any order, but every endpoint must exist in `vertices`. Duplicates and self-loops are allowed. |
| `startVertex` | string                  | Optional. If omitted or not in `vertices`, the service uses `vertices[0]`.                             |
| `Edge.from`   | string                  | Source vertex.                                                                                         |
| `Edge.to`     | string                  | Target vertex.                                                                                         |
| `Edge.weight` | number, default `1`     | Currently unused by DFS but preserved in `edgeTraces`/`edgeStepsFromStart`.                            |

### What "insertion order" means

When a DFS visits a vertex, it iterates that vertex's outgoing edges in the order
they appear in the request `edges` array. The global `visitOrder` similarly walks
`vertices` in the order they were given, restarting DFS from the next undiscovered
vertex when the current component is exhausted. The frontend preserves this order
when sending requests, so the trace is reproducible.

## Response

For the request above, the service returns:

```json
{
  "edgeStepsFromStart": [
    { "from": "A", "to": "B" },
    { "from": "B", "to": "C" },
    { "from": "C", "to": "D" },
    { "from": "D", "to": "E" },
    { "from": "E", "to": "F" },
    { "from": "F", "to": "G" }
  ],
  "vertexStepsFromStart": ["A", "B", "C", "D", "E", "F", "G"],
  "vertexTraces": {
    "G": ["G"],
    "F": ["F", "G"],
    "E": ["E", "F", "G"],
    "B": ["B", "C", "A", "D", "E", "F", "G"],
    "D": ["D", "E", "F", "G"],
    "C": ["C", "A", "B", "F", "G", "D", "E"],
    "A": ["A", "B", "C", "D", "E", "F", "G"]
  },
  "edgeTraces": {
    "G": [],
    "F": [{ "from": "F", "to": "G" }],
    "E": [{ "from": "E", "to": "F" }, { "from": "F", "to": "G" }],
    "B": [
      { "from": "B", "to": "C" },
      { "from": "C", "to": "A" },
      { "from": "C", "to": "D" },
      { "from": "D", "to": "E" },
      { "from": "E", "to": "F" },
      { "from": "F", "to": "G" }
    ],
    "D": [
      { "from": "D", "to": "E" },
      { "from": "E", "to": "F" },
      { "from": "F", "to": "G" }
    ],
    "C": [
      { "from": "C", "to": "A" },
      { "from": "A", "to": "B" },
      { "from": "B", "to": "F" },
      { "from": "F", "to": "G" },
      { "from": "C", "to": "D" },
      { "from": "D", "to": "E" }
    ],
    "A": [
      { "from": "A", "to": "B" },
      { "from": "B", "to": "C" },
      { "from": "C", "to": "D" },
      { "from": "D", "to": "E" },
      { "from": "E", "to": "F" },
      { "from": "F", "to": "G" }
    ]
  },
  "visitOrder": ["G", "F", "E", "B", "C", "A", "D"]
}
```

### Field semantics

| Field                    | Type                          | Notes                                                                                          |
|--------------------------|-------------------------------|------------------------------------------------------------------------------------------------|
| `edgeStepsFromStart`     | Edge[]                        | Ordered edges DFS traverses starting at `startVertex`. The frontend animates these one by one. |
| `vertexStepsFromStart`   | string[]                      | Ordered vertices visited starting at `startVertex` (includes the start vertex).                |
| `vertexTraces`           | { [vertex]: string[] }        | One DFS vertex trace per starting vertex.                                                      |
| `edgeTraces`             | { [vertex]: Edge[] }          | One DFS edge trace per starting vertex.                                                        |
| `visitOrder`             | string[]                      | Classic DFS visit order over `vertices`, restarting on each new component.                     |

### Errors

If a graph references unknown vertices or the request fails to validate, return:

```json
{ "message": "Edge X -> Y references unknown vertex" }
```

The frontend treats any JSON object with a `message` field as an error.

## Build & integration

The frontend loads the service as an Emscripten ES module from
`apps/web/public/services/graph-dfs/graph_service.js` and calls a single
embind-bound function:

```cpp
#include <string>
#include <emscripten/bind.h>

std::string runDFS(const std::string& request_json) {
  // ...parse, run DFS, serialize response, return JSON string
}

EMSCRIPTEN_BINDINGS(graph_service) {
  emscripten::function("runDFS", &runDFS);
}
```

Build with:

```bash
emcc -O3 dfs.cpp -o graph_service.js \
  --bind \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s EXPORT_NAME=createGraphServiceModule \
  -s ENVIRONMENT=web \
  -s ALLOW_MEMORY_GROWTH=1
```

Drop `graph_service.js` and `graph_service.wasm` into
`apps/web/public/services/graph-dfs/`. The page will detect them on the next
load and switch the backend badge from "JS fallback" to "WASM · client-side".
The frontend calls `Module.runDFS(JSON.stringify(req))` and parses the returned
string.

## Reference implementation

A TypeScript implementation that produces the canonical output for the example
above lives at `apps/web/src/lib/graph/dfs.ts`. It's the JS fallback used by the
playground when no WASM module is present, and a useful sanity check when
implementing the C++ version.
