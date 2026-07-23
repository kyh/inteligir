# @repo/server

The node backend behind `createHost()` — the composition root that wires the extracted capability packages (`@repo/storage`, `@repo/vault`, `@repo/voice`, `@repo/connectors`, `@repo/sync`) and `@repo/agent` into one host the desktop shell serves.

## Why it exists

Node-only. Nothing imports it except the desktop **main** process (`apps/desktop/src/main/index.ts`) — the renderer and mobile depend on `@repo/bridge` only, so "no node in the UI's contract" is an unresolvable-import fact. The capability packages sit BELOW it and never import it back (package cycle); upward needs cross their module-scoped install seams, which `boot/` fills. No electron imports anywhere — everything OS/shell-shaped crosses the injected `HostPlatform`. The package.json `exports` map is deliberately narrow: exactly the entrypoints desktop main composes (`boot/create-host`, `transport/ws-host`, `transport/remote-access-manager`, `capture/deep-link-service`, `platform`, `knowledge/sqlite-knowledge-store`); everything else is package-private, and widening it is a conscious exports-map change.

## Layout

```
boot/                 createHost + dependency-ordered singleton construction
                      (singletons.ts), AgentPorts + seed/login/teardown
                      (agent-wiring.ts, agent-knowledge-port.ts), post-rename
                      metadata remap (rename-orchestration.ts)
handlers/             domain-grouped Bridge handlers; handler-registry.ts is the
                      typed registrar, register-handlers.ts composes the groups
transport/            ws-host.ts (the ONE WebSocket server), device-auth.ts
                      (hashed pairing/local tokens), remote-access-manager.ts
app/                  state machine split app-reducer (pure) / app-effects
                      (deps-injected) / app-machine (queue + agent singleton);
                      agent-gateway.ts, inline-ai.ts, ghost-text.ts,
                      session-history.ts
knowledge/            host shell over @repo/notes/knowledge: knowledge-manager,
                      node:sqlite store binding, rename-rewrite (byte-surgical)
delegation/           delegation-manager (store + serialized queue),
                      background-agent, background-turn-lock, find-task-line
routines/             routines-manager — scheduled agent runs, delegation's sibling
capture/              deep-link-service (inteligir:// verbs), capture-manager
                      (durable inbox + exactly-once CAS drain)
restore/              restore-manager over snapshot-store — the AI-edit undo
provider/             provider catalog / config store / pi credential glue
agent-instructions/   vault/AGENTS.md session-context loader + once-per-vault seed
daily-note.ts         the ONE host-side daily-note path resolver
events.ts             typed emitEvent/subscribeEvents bus the transport forwards
platform.ts           HostPlatform port; platform-instance.ts the installed one
notifications.ts, ui-state.ts
```

## Invariants

- **Registry is law.** Every handler is keyed by `@repo/bridge/ipc-registry`; payloads are `Value.Check`-validated in the registrar (transports pass raw wire values in), and boot throws if any host-owned method is unhandled. `DESKTOP_SHELL_METHODS` (html-app token mint/revoke) are the shell's, excluded from the host map.
- **One host per process.** `@repo/storage/host-lock` pidfile under `~/.inteligir`; modules are process-global singletons — `getX()` is the only way in, `resetX()` + lazy rebuild is the logout/login cycle, captured references go stale.
- **`restore/` is the ONE AI-edit-undo module** (see repo Decisions): chat's tool-gate captures fail-closed behind the post-turn toast; delegation and routines snapshot pre-run behind "Restore original".
- **Routines' write path is host-owned.** A routine runs unprompted, so the agent REPLIES with markdown and the HOST appends it via the confined VaultManager write; delegation and routines never run concurrent turns on the shared background session (`BackgroundTurnLock`). `lastRunAt` stamps at dispatch — a crash skips to the next slot.
- **The knowledge index is a wipe-and-rebuild cache** (Decisions): `~/.inteligir/indexes/<hash>.sqlite` exists only to make boot cheap; corruption or version mismatch deletes and rebuilds. Nothing durable lives there.
- **Delete = OS trash** (Decisions): user deletes go through `HostPlatform.trashItem`; sync-applied remote deletes stay permanent.
- **`~/.inteligir` is owner-only** (Decisions): `createHost` runs `hardenAppDir` every boot.
- **WS auth fails closed.** Loopback while remote access is off, 0.0.0.0 when on; every socket must send an auth/pair frame within 10s; tokens live hashed (sha-256) on disk, never usable from the file.
- **Capture is exactly-once**: the open note's live buffer applies, else the host-side CAS drain onto today's daily note (`daily-note.ts` resolves the path).

## Seams

`createHost(platform, options)` — desktop main (`apps/desktop/src/main/index.ts`, via `electron-platform.ts`) injects `HostPlatform` and serves `host.handlers`/`host.events` over `startWsHost`. `boot/` fills the downward install seams: `setVaultChangeNotifier`/`setVaultTrashItem`/`setVaultWorkspaceLinkDir` (@repo/vault), `setSyncEventSink`/`setSyncVaultAccessor`/`setSyncBrowserOpener` (@repo/sync), `configureVoiceModelHost` (@repo/voice), json-store's store-recovery notifier (@repo/storage), `setDevFlagsAllowed` (@repo/bridge). `agent-wiring.ts` builds `AgentPorts` (`{ executor, knowledge, privacy, checkpoints }`) for `@repo/agent`'s extension bundles — the agent has no dep edge on this package.

## Testing

```bash
pnpm --filter @repo/server test
```

`src/__tests__/` pins the reducer/machine transition matrix, registrar completeness (`register-handlers` throws on gaps), teardown completeness across resets, delegation/routines queue + snapshot behavior, knowledge privacy fail-closed, and the restore/snapshot byte-exactness; `transport/__tests__/` pins ws auth + device pairing end-to-end.
