# Cloud migration plan — inteligir on the full Cloudflare stack

Status: **PLAN** (nothing here is implemented). Prompted by Cloudflare's
Agents Week 2026 launches — [`@cloudflare/computer`](https://blog.cloudflare.com/cloudflare-computer/),
[Sandboxes GA](https://blog.cloudflare.com/sandbox-ga/), and the Browser
Rendering → **Browser Run** rename — which together supply the pieces this
app currently gets from the user's machine: a persistent filesystem + shell
for the agent, scheduled background execution, and a headless browser.

The goal: **the product becomes a web app on Cloudflare; the Electron
desktop app becomes a thin shell around it.** Vault, host, and agent all
move server-side. Full Cloudflare stack — no other cloud vendors.

---

## 0. What this reverses (read first)

Three load-bearing principles in `CLAUDE.md` flip. Naming them up front
because everything below follows from them:

1. **"Notes never live in a server database" → notes live in R2 + a
   Durable Object manifest.** The opt-in sync coordinator
   (`apps/cloud/src/vault-coordinator.ts`) is promoted from *mirror* to
   *source of truth*. Sync stops being off-by-default because sync stops
   being a feature — it becomes the storage layer.
2. **"The agent's real machine access is the product" → the sandbox is the
   machine.** pi keeps `bash`/file tools/`browser`, but they act on a
   Cloudflare Sandbox and Browser Run, not the user's laptop. `peekaboo`
   (local screen capture) has no cloud analogue and is retired.
3. **Guest-by-default → account-required.** Better Auth (already in
   `apps/cloud`) becomes the front door, not an opt-in.

`docs/privacy.md` must be rewritten as part of Phase 1 — the contract
("content stays on your machine unless you enable sync") is void in the
target architecture. This is a *product* decision as much as a technical
one; the migration should not ship past Phase 2 without that copy.

---

## 1. Why this is feasible: the seams already exist

The repo was built around three boundaries that make this migration a
re-hosting exercise rather than a rewrite:

- **`@repo/notes` is platform-neutral by construction** (no node/electron
  imports, capabilities injected — hasher, IO, clock, `SqlDriver`). The
  sync engine, knowledge engine, and markdown pipeline all run in a Worker
  today (the cloud e2e test already drives the engine in-process against
  the real Worker).
- **The renderer is host-agnostic.** It consumes an injected `Bridge`
  (`@repo/bridge/ipc-registry` — transport-agnostic, TypeBox-validated)
  and already runs in a plain browser (`dev:harness`). The renderer does
  not know it lives in Electron.
- **Every host capability is ports-injected** (`AgentPorts`,
  `HostPlatform`, `SyncIo`, `setSecretCipherProvider`, …). "Cloud host" =
  new implementations behind existing interfaces, mostly.

What is genuinely node/OS-coupled and must be rebuilt: `@repo/storage`
(fs JsonStores), `@repo/vault` (fs VaultManager), the ws transport
(`packages/server/src/transport/`), and everything that shells out
(pi itself, the connectors executor daemon, sherpa-onnx voice).

---

## 2. Target architecture

```
Browser (or Electron shell, or Expo app)
  └─ renderer UI (unchanged) ── wss ──┐
                                      ▼
Cloudflare Worker  "app worker"  (static assets + auth + routing)
  ├─ /api/auth/*      Better Auth on D1  (exists today)
  ├─ WS upgrade ────► UserHost Durable Object   (per user)
  │                     • the @repo/server composition root, re-hosted
  │                     • Bridge handler map over DO WebSockets
  │                     • DO SQLite: JsonStore successors, knowledge index
  │                     • DO Alarms: routines, capture drain, sync ticks
  │                     ├──► Vault DO + R2      (exists: vault-coordinator)
  │                     │      manifest + bytes = the canonical vault
  │                     ├──► Sandbox (per user, persistent)   ← Sandboxes GA
  │                     │      • pi coding agent (chat + background session)
  │                     │      • ./vault materialized via the EXISTING sync
  │                     │        engine — the sandbox is just another device
  │                     │      • connectors executor daemon
  │                     ├──► Browser Run        (agent `browser` tool via CDP)
  │                     └──► Workers AI         (STT, ghost text opt.), AI Gateway
  └─ R2: vault bytes, restore snapshots, sandbox backups
```

Key structural choices:

- **One `UserHost` DO per user** replaces the local `@repo/server` host.
  The "one host per process / `host.lock`" invariant maps cleanly: a DO is
  a single-threaded singleton per id — the platform now enforces what
  `createHost` + `host.lock` enforced by hand. The process-global `getX()`
  singletons survive as DO-instance fields.
- **The vault DO is already written.** `VaultCoordinator` (SQLite manifest,
  optimistic concurrency, R2 bytes, SSE changes stream) becomes primary
  storage. A new `CloudVaultManager` implements today's `VaultManager`
  surface (confined reads/writes, listing, change classification) against
  DO manifest + R2 instead of `fs`. The "ephemeral listing" design
  dissolves: the manifest **is** the listing, and the DO changes stream
  (deliberately SSE — see Decisions) pushes vault-changed events for real,
  replacing focus-triggered crawls.
- **The agent gets its vault through sync, not FUSE.** Cheapest correct
  option: the sandbox runs the existing node sync adapter
  (`packages/sync/src/sync-manager.ts`) against the coordinator, so
  `./vault` inside the sandbox is a real directory pi's native file tools
  already understand, and agent edits flow back through the same 3-way
  reconcile (conflict copies, deletion gate — all preserved). Evaluate
  `@cloudflare/computer`'s virtual filesystem as a later simplification,
  but do not block on it: the sync path reuses ~all existing code.

---

## 3. Subsystem-by-subsystem migration map

| Local today | Cloud target | Fate of the code |
|---|---|---|
| `@repo/vault` VaultManager (fs, atomic writes, `./vault` symlink) | `CloudVaultManager` over Vault DO + R2 | New impl behind the same interface; fs impl survives for the desktop offline cache (§6) |
| Ephemeral listing + open-note watcher | DO manifest + changes stream → Bridge events | Watcher/classifier retired server-side; classifier reused for sandbox-side edits |
| `@repo/storage` JsonStores over `~/.inteligir` (0600/0700 hardening) | DO SQLite (versioned rows, same JsonStore API) | New driver; `hardenAppDir`, host lock, atomic-write machinery retired |
| SecretStore (host-cipher-injected) | Workers secrets for platform keys; per-user secrets encrypted in DO storage (envelope key in a Worker secret) | Cipher seam already injected — new provider |
| Knowledge: SQL KnowledgeStore over injected `SqlDriver` (`~/.inteligir/indexes/*.sqlite`) | Same store, `SqlDriver` bound to DO SQLite in `UserHost` | **Spike required: FTS5 in DO SQLite** (§5.1). Fallback: index lives in the sandbox; second fallback: D1 per user. Wipe-and-rebuild contract unchanged and now cheap (rebuild from R2) |
| ws transport (`startWsHost`, loopback token, remote-access bind + pairing) | DO WebSockets on `UserHost`; Better Auth bearer/session at upgrade | `ws-host` rewritten (hibernatable WS API); **all of remote-access — manager, device roster, `network-endpoints.ts` CGNAT/overlay classification, pairing — retired.** `REMOTE_ALLOWED_*` allowlists survive as per-client-class capability gates (mobile ≠ full renderer) |
| Bridge (`ipc-registry`, `createWsBridge`) | Unchanged contract; client dials `wss://` with auth instead of loopback boot token | Keep; add auth handshake |
| pi agent, local process, provider OAuth in `~/.inteligir` | pi in the per-user **Sandbox** (persistent; snapshot/R2-backup across restarts). Chat streams: sandbox → UserHost DO → Bridge WS | `@repo/agent` largely survives (it already never imports server); `setup/auth` reworked — OAuth callback lands on the Worker, token written into the sandbox's pi auth.json |
| Agent `browser` tool (local Chromium) | **Browser Run** (CDP endpoint from the Worker binding, passed into the sandbox) | Swap endpoint; Live View / human-in-the-loop is a new product opportunity for delegation review |
| `peekaboo` (macOS screen capture) | Retired (no cloud analogue). Browser Run screenshots cover web cases | Delete bundle |
| Delegation (`delegation-manager`, background pi session, pre-run snapshot) | Same manager in UserHost DO; runs `exec` in the sandbox's background session; snapshots to R2 | Queue/lock/epoch logic survives; timers → DO alarms |
| Routines (timer, host-owned write path) | DO **Alarms** — the exact primitive this wants; epoch guard and host-owned append unchanged | Near-verbatim port |
| Restore/snapshots (`server/restore/`, newest-50 bytes under `~/.inteligir`) | SnapshotStore over R2 (retention rule intact); fail-closed capture gate unchanged | Storage swap |
| Capture / deep links (`inteligir://`, CAS drain) | `https://app.…/capture?…` web deep links; Electron shell keeps registering `inteligir://` and forwards to the web app; CAS drain in DO | Parser reused; add web routes |
| Connectors (executor daemon, MCP) | Executor daemon runs in the sandbox; OR adopt Agents SDK native MCP client (spike) | Ports-injected already (`ExecutorPort`) |
| Voice: sherpa-onnx STT local; ElevenLabs TTS via proxy | STT → **Workers AI** (whisper); TTS proxy moves into the app worker (already proxy-shaped) | Model download/installer path retired |
| Editor AI + ghost text (two no-tools pi sessions) | Same sessions in the sandbox; or direct AI Gateway calls from UserHost for latency (ghost text especially — spike §5.4) | Keep contract (transient-only) |
| HTML apps (`vault-app://` protocol, opaque-origin iframe, postMessage broker) | Serve from a **separate sandbox origin** (`*.apps.inteligir.dev` or a usercontent domain), still `sandbox=` without `allow-same-origin`; broker over postMessage unchanged | **Security-critical change**: on the web, `event.origin` becomes meaningful — re-audit the broker per the standing note before shipping |
| Better Auth `baseURL` derived from request origin (safe: workers.dev only) | App gains real custom domains → **the documented revisit trigger fires**: origin must be gated/allowlisted | Small, but mandatory in Phase 1 |
| Mobile companion (pairing, one-time token, device roster) | Signs into the same cloud host with Better Auth; pairing UX deleted | Big simplification; device-key work from #529/#531 is the foundation |
| `@repo/installer` (GitHub-release binary provisioning) | Still used — inside the sandbox image/bootstrap (pi, executor) | Unchanged |
| Marketing site (`apps/web`) | Gains `app.` — or the app becomes a second TanStack/Vite site on Workers static assets serving the current renderer | Renderer moves; see Phase 1 |

**Privacy (`private: true`)** deserves its own row-in-prose: the fail-closed
gates (per-call live-disk probe, index drops, hard-off editor AI) all move
server-side into the DO ports and the sandbox's pi hook. The enforcement
story actually *improves* for surfaces (the server can gate uniformly), but
the trust story changes completely (private notes are still bytes on
Cloudflare). The rewritten privacy doc must say both.

---

## 4. Phases

Each phase ships something usable and keeps `pnpm verify` green. Order is
chosen so the riskiest unknowns (sandbox economics, pi-in-sandbox) are
validated before the point of no return (flipping storage primacy).

### Phase 0 — Spikes (no product change)
Prove the five unknowns in §5. Exit criteria are written per-spike. ~Small,
timeboxed; everything later assumes their answers.

### Phase 1 — The web app exists (read-only), cloud host skeleton
- New `apps/app` (Workers static assets) serving the current renderer
  bundle; `installBridge(createWsBridge(wss://…))` with Better Auth.
- `UserHost` DO with the Bridge handler map; implement the read channels
  over the existing coordinator (listing, note read, knowledge queries via
  the DO-SQLite index built from R2).
- Auth origin gating (the custom-domain trigger).
- Desktop unchanged and primary. The web app is "your synced vault,
  readable in a browser" — sync users get value immediately; editing
  arrives with the write paths in Phase 2.

### Phase 2 — Cloud vault becomes source of truth
- `CloudVaultManager`; all write paths (editor autosave, rename byte-surgery,
  frontmatter, assets to R2, templates, daily notes) through the DO.
- Changes stream → Bridge `vault-changed`; retire crawl-on-focus in the
  web app. In-cloud trash (R2 soft-delete/versioning) replaces OS trash —
  the "Delete = OS trash" decision is re-decided for cloud.
- JsonStore successors in DO SQLite (ui-state, delegations, routines,
  sync-config…). Migration tool: desktop pushes `~/.inteligir` state up
  once at first cloud sign-in.

### Phase 3 — Agent in the sandbox
- Per-user persistent Sandbox: bootstrap image with node + pi + the sync
  adapter; `./vault` materialized by sync against the coordinator.
- Chat over Bridge → UserHost → sandbox pi session; streaming back over
  the same WS. Restore captures to R2 (fail-closed gate intact).
- `browser` tool → Browser Run; `peekaboo` removed; grant table
  (`@repo/bridge/agent-grants`) re-reviewed — "no sandbox, policy-only"
  Decisions entry is obsolete: **the never-granted tier finally becomes
  enforceable** (the sandbox has no path to the user's machine, and the
  egress proxy can enforce it network-side).
- Editor AI + ghost text on the low-latency path chosen in spike §5.4.

### Phase 4 — Background work + long tail
- Delegation + routines on DO alarms driving sandbox turns (shared
  background-turn-lock semantics preserved in the DO).
- Connectors executor in the sandbox (or Agents SDK MCP), Google OAuth
  redirect moved to the Worker.
- Voice: Workers AI STT, TTS proxy in-worker. Capture drain in DO.
- HTML apps on the isolated origin, broker re-audit.

### Phase 5 — Electron becomes a shell; mobile simplifies
- Desktop `main` shrinks to: BrowserWindow → `https://app.…`, `inteligir://`
  protocol registration forwarding to web routes, tray/global shortcuts,
  auto-update of the shell only. Preload/ws-bootstrap, local server boot,
  `host.lock`, remote-access — deleted.
- **Offline story (decide explicitly):** Option A (recommended): the shell
  keeps a local vault replica via the existing sync engine and can serve a
  degraded read/edit mode; Option B: online-only like Figma. The sync
  engine's existence makes A cheap; the web app also gains a real origin,
  which un-blocks the service-worker path the `file://` Decisions entry
  said to wait for.
- Mobile: drop pairing/`REMOTE_ALLOWED_*` transport for direct cloud auth;
  its sync adapter becomes an offline cache like the desktop's.
- Retire: `packages/server/src/transport/` remote-access half,
  `network-endpoints.ts`, pairing UI, worktree port-derivation for the ws
  host, `hardenAppDir` — with a Decisions-section rewrite in `CLAUDE.md`.

---

## 5. Spikes (Phase 0) — the things that can kill this

1. **FTS5 in Durable Object SQLite.** The knowledge index needs bm25 FTS.
   Verify DO SQLite exposes FTS5; else pick the fallback (sandbox-resident
   index vs D1-per-user) and measure query latency from the DO.
2. **pi inside a Sandbox.** Boot pi headless in a sandbox, run a chat turn
   and a file edit, snapshot/restore, measure cold-resume time. Includes
   provider OAuth: the callback must land on the Worker and the token be
   injected — check whether pi's refresh flow tolerates that (auth.json is
   pi-owned; the sandbox egress proxy's credential injection may be the
   cleaner answer than teaching pi anything).
3. **Sandbox economics.** One persistent sandbox per user: measure
   active-CPU cost for a realistic day (a few chat turns, one delegation,
   idle otherwise) and the concurrency ceilings (15k lite instances on the
   standard plan) against expected DAU. This decides per-user vs
   on-demand-per-turn sandboxes — the architecture above assumes
   per-user-persistent; if cost says otherwise, sync-materialization makes
   per-turn viable too (fresh sandbox + sync pull ≈ seconds, needs
   measuring).
4. **Ghost-text latency.** Local loopback → DO → sandbox → provider will
   feel worse than today's local path. Measure; likely answer is direct
   provider calls from the UserHost DO via AI Gateway for the two
   no-tools sessions, keeping the sandbox for tool-using sessions only.
5. **Browser Run from pi.** Point pi's browser tool at a Browser Run CDP
   endpoint; verify session lifetime, auth handoff, and that Live View can
   be surfaced in the renderer for human-in-the-loop.

---

## 6. What survives untouched (worth stating)

`@repo/notes` in full (engine, knowledge, markdown, vault-search,
task-schedule, guarded-line-edit); `@repo/bridge` contracts (ipc-registry,
agent-grants, deep-link parser, routine-schedule); the renderer UI and its
cadence-split vault context; the Plate editor and byte-pinned fixture
matrix; the dev harness (still the fastest loop — the fixture Bridge is
now also the web app's harness); delegation/routine manager logic; the
grant-table + confirmation-broker design; Better Auth + D1 + the vault
DO + device-key work. That is most of the intellectual property of the
repo — which is the argument that this migration is tractable.

## 7. Open product questions (not blockers, but decide early)

- **Pricing/tenancy**: a per-user sandbox + DO + R2 has a real marginal
  cost; the local-first app had none. Free tier shape?
- **Data residency/encryption**: at-rest encryption is table stakes; true
  E2EE is *incompatible* with a server-side agent reading notes — say so
  explicitly rather than implying it later.
- **Self-hosting**: today a self-hoster points Settings → Account at their
  own Worker. Keeping the whole stack deployable-by-one-owner (as
  `apps/cloud` is today) preserves that story and is cheap if maintained
  from the start.
- **Vault export**: with the local folder gone, "your notes are markdown
  you own" needs a one-click full-vault export (R2 → zip) to stay honest.
