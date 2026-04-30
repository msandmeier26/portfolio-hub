# Portfolio Hub

The website that hosts and orchestrates my portfolio microservices. Visitors interact with algorithms (sorting, pathfinding, etc.) implemented as separate services in C++, C, or Java. The hub provides the UI and routes requests to the appropriate service.

## Architecture

- `apps/web/` — Next.js website (frontend + thin API routes)
- `packages/api-clients/` — Generated TypeScript clients per service
- `openapi/` — API contracts for each microservice
- `docker-compose.yml` — Local dev orchestration

Each microservice lives in its own repo (`portfolio-service-*`) and exposes a REST API documented by an OpenAPI spec.

## Local development

```bash
cd apps/web
npm run dev
```

Then visit http://localhost:3000.

## Adding a new service

1. Build the service in its own repo from `portfolio-service-template-cpp`.
2. Copy its `openapi.yaml` into this repo at `openapi/<service-name>.yaml`.
3. Generate the typed client: `npm run generate:clients`.
4. Add the service to `docker-compose.yml`.
5. Use the generated client from `apps/web/`.
