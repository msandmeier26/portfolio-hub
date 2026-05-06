# Portfolio Hub

The website that hosts my portfolio "playgrounds": interactive UIs that visitors use to drive algorithms I implemented in C++. Each algorithm is cross-compiled to WebAssembly and runs entirely on the visitor's device — no backend, no servers, deployable to any static CDN.

## Architecture

- `apps/web/` — Next.js website. Configured for static export (`output: "export"`).
- `apps/web/public/services/<name>/` — drop folder for built WebAssembly modules served as static assets.
- `services/<name>/` — JSON contract docs and integration notes per service.
- `openapi/` — OpenAPI version of each service's contract (transport-agnostic).

Each service lives in its own repo (`portfolio-service-*`). The C++ source there is cross-compiled with Emscripten + embind into a `<name>.js` + `<name>.wasm` pair, which gets dropped into the hub's `public/services/<name>/` folder. The frontend dynamically loads the module and invokes the bound function directly — no HTTP round-trip.

## Local development

```bash
cd apps/web
npm run dev
```

Then visit http://localhost:3000.

## Production build

```bash
cd apps/web
npm run build
```

Outputs a fully static site under `apps/web/out/` ready to upload to Cloudflare Pages, Netlify, or any static host. See [`DEPLOYMENT.md`](DEPLOYMENT.md) for the Cloudflare Pages setup.

## Adding a new service

1. Build the service in its own repo. Expose a single embind-bound function that takes a request JSON string and returns a response JSON string.
2. Document the JSON contract at `openapi/<service-name>.yaml` and `services/<service-name>/README.md`.
3. Cross-compile to WASM and copy `<service>.js` + `<service>.wasm` into `apps/web/public/services/<service-name>/`. The frontend will pick it up automatically; if it's missing, the playground falls back to a bundled TypeScript reference implementation that runs in the same tab.
