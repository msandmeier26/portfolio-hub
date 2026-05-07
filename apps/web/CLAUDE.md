@AGENTS.md

# Project context

This is the **frontend** repository (`portfolio-hub`). It hosts a Next.js
website that loads C++ algorithms compiled to WebAssembly.

The C++ source for those algorithms lives in **separate repositories** that
are NOT part of this workspace (e.g., `portfolio-service-graphs`). You will
not have access to those files. The compiled WASM artifacts arrive here as
prebuilt assets in `apps/web/public/services/<service-name>/`.

## Scope rules

- Only modify files within this repository.
- Files under `apps/web/public/services/` are compiled WebAssembly artifacts.
  Treat them as opaque binaries — never modify them directly.
- If understanding a service's API would help, read its contract at
  `services/<name>/README.md` or `openapi/<name>.yaml`. Reading the C++
  source is also allowed for context — the service repos live alongside
  this one at `/home/manja/Portfolio/services/portfolio-service-*/`.
  Do not propose changes to the C++ side of any service.
- If a frontend issue appears to require a C++ change, surface the issue
  to the user in plain prose — do not attempt to work around it on the
  frontend side.

## Architecture

- The C++ side owns all graph state and algorithmic logic.
- The frontend's role is: capture user input, forward it to the WASM
  module, render the current state, animate algorithm traces.
- The frontend should NOT maintain its own graph data model that mirrors
  what the C++ side already represents. Single source of truth lives in C++.

## Working notes

(empty — to be populated as APIs solidify)