# Deployment — Cloudflare Pages

The hub is a static site (Next.js `output: "export"`) so Cloudflare Pages serves
it directly with no Workers, no functions, and no runtime configuration. Every
algorithm runs as a WebAssembly module in the visitor's browser.

This guide walks through deploying to **`portfolio.swchalet.com`**.

`swchalet.com` is on Cloudflare's nameservers (`adele.ns.cloudflare.com`,
`randall.ns.cloudflare.com`), so attaching the subdomain is a one-click step.

---

## Prerequisites

- The repo is pushed to GitHub (`github.com/msandmeier26/portfolio-hub`) including the WASM
  artifacts under `apps/web/public/services/`.

## 1. Push the latest changes

The build produces `apps/web/out/`, so make sure the source — including the
`graph_service.js` and `graph_service.wasm` files in
`apps/web/public/services/graph-dfs/` — is committed and pushed.

```bash
git add .
git commit -m "Switch to static export, vendor WASM artifact"
git push origin main
```

## 2. Create the Cloudflare Pages project

1. Go to **Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git**.
2. Authorize Cloudflare to access your GitHub account if prompted, then select
   `msandmeier26/portfolio-hub`.
3. **Set up builds and deployments** — these are the values that work for this repo:

   | Field                    | Value                          |
   |--------------------------|--------------------------------|
   | Project name             | `portfolio-hub` (or anything)  |
   | Production branch        | `main`                         |
   | Framework preset         | **Next.js (Static HTML Export)** |
   | Root directory           | `apps/web`                     |
   | Build command            | `npm install && npm run build` |
   | Build output directory   | `out`                          |

4. **Environment variables → Production:**
   - `NODE_VERSION` = `22`

5. Click **Save and Deploy**. Cloudflare clones the repo, runs the build, and
   publishes the contents of `apps/web/out/` to a `*.pages.dev` URL within ~1–2
   minutes. Open it and confirm the playground loads and the **WASM · client-side**
   badge turns green when you visit `/playgrounds/graph/`.

   > If the badge stays on **JS fallback**, the WASM files didn't make it into the
   > deploy. Check the Cloudflare build log for the line "Files uploaded: …"; the
   > count should include `services/graph-dfs/graph_service.js` and `.wasm`.

## 3. Lock the project down before exposing it (password protection)

Before attaching the custom domain, gate the project with **Cloudflare Access**
so neither the `*.pages.dev` URL nor the eventual `portfolio.swchalet.com` is
public. This is free (up to 50 users on the Zero Trust free tier), no code, and
removable in one click later.

1. From the Cloudflare dashboard, click **Zero Trust** in the left sidebar. If
   it's the first time on this account, accept the free plan and pick a team
   name (e.g. `swchalet`); that name only shows up in Cloudflare admin URLs.
2. **Access → Applications → Add an application → Self-hosted.**
3. Application name: `Portfolio Hub`. Session duration: 24 hours.
4. **Application domain:** `portfolio.swchalet.com`.
   - Add a second application entry for the `*.pages.dev` host as well — there's
     a separate "Add additional domain" link. Use the exact `*.pages.dev` URL
     Cloudflare gave you after the first deploy. This closes the loophole.
5. **Identity providers:** the default *One-time PIN* is enough — visitors enter
   their email, get a code, and are let through.
6. **Policies → Add a policy:**
   - Policy name: `Allow listed users`
   - Action: **Allow**
   - Configure rules → Include → **Emails** → list every email address that
     should have access (yours, your friend's, etc.).
   - For broader access (e.g. anyone with `@somecompany.com`), use **Email
     domain** instead.
7. Save. From now on every request to either domain is intercepted by
   Cloudflare's login page; only listed emails get through.

To remove the gate later, delete the Access application — the site becomes
public again instantly.

> Alternative: if you want a shared password instead of per-email auth (so you
> can paste it into a chat and people don't need to verify their email), the
> simplest path is a Cloudflare Pages Function with HTTP Basic Auth. Less
> elegant but lower friction. Open an issue / ping me if you want this instead.

## 4. Attach the subdomain

In the project → **Custom domains → Set up a custom domain**:

1. Enter `portfolio.swchalet.com`.
2. Cloudflare will recognize the domain is on its DNS and show "Domain is on
   Cloudflare". Click **Activate domain**. The CNAME and TLS cert are
   provisioned within a few seconds.

That's it — the subdomain is live with HTTPS, behind the Access gate.

## 5. Sanity check the deployment

Visit `https://portfolio.swchalet.com/playgrounds/graph/` (you'll be challenged
by the Cloudflare Access login first) and verify:

1. The page loads and the home link works.
2. The header badge reads **WASM · client-side** (green).
3. Clicking **Run DFS** animates the traversal.
4. Saving a custom random-graph profile and reloading the page restores it
   (verifies `localStorage` is intact across the static deploy).

## How CI/CD works after this

Cloudflare watches the `main` branch. Every push triggers a fresh build and an
atomic deploy with a new immutable URL; the custom domain swaps over in seconds.
Branch pushes get their own preview URLs at `https://<branch>.<project>.pages.dev`.

When you ship a new algorithm:

1. Build the Emscripten artifacts in the service repo (`<name>.js` + `<name>.wasm`).
2. Drop them into `apps/web/public/services/<name>/`.
3. Commit + push. Cloudflare auto-deploys.

No restart, no migrations, no servers.

## Alternative: direct upload via Wrangler

If you don't want GitHub integration, you can build locally and upload the
artifact directly with [Wrangler](https://developers.cloudflare.com/workers/wrangler/):

```bash
cd apps/web
npm run build
npx wrangler pages deploy out --project-name=portfolio-hub
```

The first run prompts for OAuth; subsequent deploys are non-interactive.

## Caching and headers

Cloudflare Pages serves `.wasm` files with `Content-Type: application/wasm`
automatically — no config needed for the WebAssembly module to load. Static
assets are edge-cached aggressively; deploys invalidate the cache.

If you want explicit cache headers (e.g. for the WASM file, since it's content-
hashed by changes anyway), drop a `_headers` file at the project root:

```
/services/*
  Cache-Control: public, max-age=31536000, immutable
```

This is optional. The defaults are sensible.
