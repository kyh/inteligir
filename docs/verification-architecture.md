# Verification Architecture

> Goal: make `inteligir` verifiable by an agent running in an **ephemeral,
> headless, Docker-less cloud container** (Claude Code on the web), beyond
> the current `typecheck` / `lint` / `build` gates.

Status: **plan + spike**. A working proof-of-concept of the linchpin (a
Docker-free Postgres for tests) lives in `packages/db` — see
[The spike](#the-spike-already-landed) below.

---

## The problem

A web session runs in a throwaway Linux container with no display, no Docker
daemon, and a network policy that may restrict outbound traffic. So the only
question that matters for any check is: **can it run headlessly, offline, with
no Docker and no GUI?**

Today only four things clear that bar:

| Check              | Command                      | Clears the bar?                       |
| ------------------ | ---------------------------- | ------------------------------------- |
| Typecheck          | `pnpm typecheck`             | ✅                                    |
| Lint               | `pnpm lint`                  | ✅                                    |
| Build              | `pnpm build`                 | ✅ (weak for web — see below)         |
| Desktop unit tests | `pnpm -F @repo/desktop test` | ✅ (12 files, pure logic + `vi.mock`) |

Everything else does **not**:

- **The web app is unverified beyond build.** Worse, `apps/web/next.config.js`
  sets `typescript.ignoreBuildErrors: true`, so `build` doesn't even catch type
  errors there — only the separate `typecheck` does.
- **No tRPC / API tests.** Routers in `@repo/api` reach the DB, better-auth,
  Stripe and the AI gateway directly.
- **DB testing is broken for cloud.** `pnpm db:start` → Supabase local →
  **Docker**, which isn't present in the container. So even "manual local DB
  testing" doesn't exist in a web session.
- **Desktop has unit coverage but no proof the Electron app launches/renders**
  or that IPC round-trips — Electron needs a display.

The desktop app already shows the pattern we want everywhere: pure logic
(reducers, state machines, parsers) tested with `vi.mock` at the I/O edges. The
rearchitecture is largely **generalizing that discipline** and **removing the
Docker dependency from the test path**.

---

## Environment findings (this container)

Probed on 2026-05-29. Network here is fairly open, but policies vary per
environment, so the design degrades gracefully where something is blocked.

| Capability             | Result                   | Implication                                           |
| ---------------------- | ------------------------ | ----------------------------------------------------- |
| npm registry           | ✅ reachable             | deps install in setup                                 |
| Playwright browser CDN | ✅ reachable (307)       | browsers can be downloaded                            |
| GitHub                 | ✅ reachable             | —                                                     |
| Stripe API             | reachable (404 response) | external APIs reachable here, but still mock in tests |
| **Docker**             | ❌ not installed         | Supabase-local can't run → use PGlite                 |
| System Chromium        | ❌ absent                | Playwright must fetch its own browser                 |
| `xvfb-run`             | ✅ present               | Electron E2E is feasible                              |

---

## The five pillars

### A. Separate logic from I/O (seams)

Most code is unverifiable because business logic is entangled with external
clients. Two moves:

1. Every tRPC procedure takes its dependencies from `ctx` (db, session, Stripe,
   AI gateway) — never imports a singleton. Then routers are testable via
   tRPC's `createCaller` with a fake `ctx`.
2. Pull pure logic (validation, pricing, permission checks, transforms) into
   plain functions → trivial unit tests.

Concretely, `packages/db/src/drizzle-client.ts` is currently a **singleton**
(`export const db = drizzle(...)`). Convert it to a factory
(`createDb(driver)`) so production wires the `postgres-js` driver pointed at
Supabase and tests wire PGlite. Keep a default export for existing call sites.

### B. A Docker-free Postgres for tests — the linchpin ✅ (spiked)

Use **PGlite** (`@electric-sql/pglite`): a full Postgres engine compiled to
WASM that runs in-process — no daemon, no Docker, no display. Drizzle ships a
PGlite driver (`drizzle-orm/pglite`), and the **real** schema is applied with
drizzle-kit's programmatic `pushSchema`, so tests hit the actual tables,
enums, constraints and relations. This unlocks real-Postgres integration tests
for `@repo/db` and `@repo/api`, fully headless, in the cloud container.

### C. Headless E2E for the real UIs

- **Web:** Playwright + headless Chromium. Its `webServer` boots `next start`
  against the PGlite test DB + seed data + a **test-mode auth bypass**. Smoke
  tests assert pages render and key flows (waitlist signup, nav, docs) work.
  This codifies what the `agent-browser` skill does interactively into a
  repeatable, CI-gated suite.
- **Desktop:** Playwright's Electron support (`_electron.launch`) under
  `xvfb-run`. A few smoke tests — app launches, main window loads, one IPC
  round-trip — guard the wiring; existing unit tests keep covering logic.

### D. One command + SessionStart hook + CI parity

- A turbo `verify` task = `typecheck + lint + test (unit + integration) + e2e`,
  optionally tiered `verify:fast` (no e2e) vs `verify:full`.
- A `.claude/settings.json` **SessionStart hook** that preps the container:
  `pnpm install`, build deps, install Playwright browsers + system deps, init
  PGlite, seed. (See the `session-start-hook` skill.) This guarantees every web
  session can actually run the suite.
- A **GitHub Actions** workflow running the same `pnpm verify` on PRs. Today
  `.github/workflows/claude.yml` only wires the `@claude` action — there is no
  test CI — so the PR check becomes the shared source of truth that matches
  what the agent runs locally.

### E. Stub the network edges

Put Stripe / AI gateway / OAuth behind injectable clients with fakes (or MSW,
which is already in the dependency tree). Tests must pass even under a
locked-down network policy.

---

## Suggested order (highest verifiability-per-effort first)

1. ✅ **PGlite test-db harness** in `@repo/db` — spiked; productionize as a
   `createDb` factory + shared `createTestDb` helper.
2. **tRPC `createCaller` integration tests** in `@repo/api` over PGlite.
3. **Web Playwright smoke suite** (test-mode auth + seeded PGlite).
4. **`pnpm verify` umbrella** + SessionStart hook + CI workflow.
5. **Electron Playwright smoke** under xvfb.
6. **UI component tests** (lower priority — E2E covers rendering).

---

## The spike (already landed)

`packages/db` now has a working proof of Pillar B:

- `src/testing/pglite.ts` — `createTestDb()`: spins up PGlite, wraps it with
  Drizzle, and applies the **real** schema via `drizzle-kit/api`'s
  `pushSchema`.
- `src/__tests__/pglite-spike.test.ts` — round-trips a `waitlist` row against
  the real `user`/`waitlist` tables and asserts a real FK constraint fires.

Run it:

```bash
pnpm -F @repo/db test
```

Result: 2 tests pass in ~2.8s, no Docker, no network, no display. This is the
evidence that the rest of the plan is viable in a web session.

> Note: the spike helper lives under `src/testing/` and uses dev-only deps
> (`@electric-sql/pglite`, `drizzle-kit`). When productionized, keep the test
> harness out of the package's runtime export surface.
