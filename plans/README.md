# Plans — record

All 22 plans (2026-07-07 → 2026-07-09) were executed, reviewed, and merged;
the plan files are deleted — PRs #405–#424 are the record (each PR body
summarizes its plan). Decisions live in `docs/adr/`; vocabulary in
`/CONTEXT.md`; architecture in `/CLAUDE.md`. What survives here is the part
worth keeping in front of future audits.

## Findings considered and rejected (do not re-audit)

- **IPC "triple maintenance" restructure** — measured: adding a channel is 3
  typecheck-enforced edits (registry, handler, fixture-bridge); preload and
  renderer auto-derive. The cost buys compile-time contract enforcement
  across four surfaces. Not worth a generator.
- **Splitting/trimming `@repo/ui`** — every component has consumers
  (desktop-first, web reuses a slice). Justified as-is.
- **Server "Manager" abstraction teardown** — VaultManager, KnowledgeManager,
  DelegationManager etc. are concrete stateful classes, not single-impl
  interfaces; no pass-through layer to delete.
- **Base+React kit-pairing reduction** — correctly applied: only
  serializer-mirror kits are in `BASE_KIT`; live-only surfaces excluded.
- **Watcher-scoped knowledge refresh** — superseded by ADR-0001's ephemeral
  index; per-save stat sweeps no longer exist.
- **Turbo test caching** (`test` is `cache: false`) — deliberate blanket-off;
  per-package caching risks stale-green without careful `inputs`.
- **Gitignoring `worker-configuration.d.ts`** — typecheck consumes it; kept
  committed, marked `linguist-generated -diff` in `.gitattributes`.
- **First-user-owns-vault authz model** — enforcement verified correct;
  the model is a decided tradeoff.
- **Version-conflict as HTTP-200 `{ok:false}` value** — decided design.
- **Agent's unconfined filesystem access** — intentional: the agent equals
  the user; the renderer IPC path is the hardened surface.
- **hubble.md non-adoptions** — their sync (last-writer, no auth), a Tiptap
  migration, Biome, non-atomic writes: all strictly behind what we have.
- **Broker path checks vs vault resolve()** — ADR-0002 defense-in-depth
  across a trust boundary, not duplication.

## Deferred (build when dogfooding demands it)

Tag chips in Rich mode + a tags sidebar; periodic notes (weekly/monthly);
inline `<iframe src="./x.html">` embeds in notes (needs an MDX-vocabulary
decision + height sync — the runtime already reports height); mobile asset
rendering; export (md bundle/HTML/PDF); multi-vault quick-switcher; a
first-class web-search agent tool; publish/share (own design pass; foreign
HTML becomes the RCE surface — re-audit the broker capability set first).

## Operator checklist (two minutes, still pending)

- Paste a screenshot into a real note in Electron; reload; it renders.
- Click an external `[link](https://…)` in a note → system browser opens,
  app window stays put.
- Ask the chat agent to `search_vault` + `get_backlinks` with a live pi login.
- A real two-device sync conflict shows in Settings → Sync (e2e-covered
  in-process already).
