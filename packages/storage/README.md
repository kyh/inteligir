# @repo/storage

Node fs/json substrate for the host: versioned `JsonStore` over `~/.inteligir`,
atomic-write, the single-host pidfile lock, the boot-time permission sweep
(`hardenAppDir`), and the `agent.log` console tee.

## Why it exists

Node-only (Electron main / the `@repo/server` host) — never renderer or
mobile. A **leaf**: no workspace deps (two one-line guard copies in
`fs-errors.ts` exist precisely to keep it that way); upward needs (recovery
notifier, pi session-dir names) cross injected seams the composition root
fills. Anything persisting app state under `~/.inteligir` goes through it so
atomicity and owner-only modes are inherited, not re-implemented.

## Layout

```
src/
  json-store.ts      # JsonStore<T>: schema-validated JSON over ~/.inteligir —
                     #   TypeBox check on read AND write, quarantine-on-drift,
                     #   close() kill switch; realFs adapter (0600/0700);
                     #   inteligirPath(), shortPathKey(), recovery-notifier seam
  atomic-write.ts    # The ONE tmp-then-rename dance; explicit chmod on the tmp
                     #   so a stale crash-leftover can't smuggle a wider mode
  host-lock.ts       # Pidfile lock on ~/.inteligir/host.lock: refuse a second
                     #   host, reclaim stale locks, reassert after logout wipe;
                     #   isProcessAlive (shared signal-0 probe)
  harden-app-dir.ts  # Once-per-boot best-effort sweep: 0700 dirs, 0600 data
                     #   files (stores + quarantine siblings, transcripts,
                     #   snapshots, index sqlite trio)
  agent-log.ts       # Tee console.warn/error + [tag]-prefixed log lines to
                     #   ~/.inteligir/logs/agent.log; size-capped, one rotation
  fs-errors.ts       # isEnoent / isRecord / toErrorMessage — leaf-local guards
```

Exports map = exactly these six subpaths; no barrel.

## Invariants

- **`~/.inteligir` is owner-only** (CLAUDE.md § Decisions): transcripts and
  snapshots carry note content. New writes are 0600 files / 0700 dirs by
  construction (`realFs`); `hardenAppDir` re-asserts it every boot for history
  and third parties — pi keeps creating transcripts 0644 mid-session. pi's
  auth.json stays pi-owned (plaintext-but-0600 by design; no cipher seam).
- **Version drift is quarantine-only.** No migration registry exists —
  deliberately removed until a real migration ships. Any version other than
  `current` (newer, older, missing) sets the file aside (`.newer-v<N>-<ts>` /
  `.corrupt-<ts>`) and resets to defaults; the original bytes always survive
  at the backup path and a recovery event surfaces it.
- **Writes validate too.** An encoded value failing the store's own schema
  throws before cache or disk are touched — persisting it would make the next
  read quarantine the file, silently wiping user state.
- **`close()` is a one-way kill switch.** Logout teardown closes every store
  before `rm -rf`'ing `~/.inteligir`; without it an in-flight handler's stale
  reference would recreate the dir via `realFs.write`'s mkdir.
- **One host per state dir.** `acquireHostLock` throws beside a live pid —
  two hosts would resume the same pi session and fight over the executor
  daemon. Stale locks (dead pid, garbage) reclaimed silently.
- **`hardenAppDir` skips `bin/`, `extensions/`, `workspace/`, `skills/`** —
  exec bits and user-owned vault. Every chmod try/caught: never block boot.
- `agent.log` skips per-token deltas and untagged info lines — one model turn
  must not amplify into thousands of file writes.

## Seams

- `setStoreRecoveryNotifier` — default user-facing surfacing for quarantines
  (OS notification pointing at the backup). Bound in
  `packages/server/src/boot/singletons.ts`; unbound (vitest), console.error is
  the only record. Keeps the json-store ↔ notifications edge one-way.
- `hardenAppDir(sessionDirs)` — the pi session-dir names are PASSED IN
  (`SESSION_DIR_SEGMENTS` from `@repo/agent/paths`) so a new session dir can't
  silently escape the 0600 sweep; storage never imports agent code. Called at
  boot by `packages/server/src/boot/create-host.ts`, re-run on wake by the app
  machine.
- `JsonStore.fs`, `hardenAppDir`'s `root`, `createAgentLogWriter`'s
  `dir`/`maxBytes` — test-only injection; production uses the defaults.

## Testing

```bash
pnpm --filter @repo/storage test
```

`json-store.test.ts` pins quarantine-not-migrate (newer/older/unversioned →
backup + defaults, bytes preserved), write-time schema refusal, real-fs
0600/0700 modes incl. healing a crash-leftover tmp, and no by-reference cache
leaks. `host-lock.test.ts`: refuse-live / reclaim-stale / release-only-our-own.
`harden-app-dir.test.ts`: the sweep's reach and its skips. `agent-log.test.ts`:
tag filtering, `message_update` skipping, rotation, logout-wipe survival.
