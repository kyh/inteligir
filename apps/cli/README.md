# @repo/cli — the `inteligir` CLI

Drives a running local app over the typed API client (`@repo/server-contract`).
Agent-facing by design: every leaf command takes `--json`, the app serves the
manual (`GET /api/v1/guide`, printed by `inteligir guide`), and the agent
runtime injects `INTELIGIR_SERVER_URL` + `INTELIGIR_THREAD_ID` into codex
shells so the model can drive the product through bash.

## Running it

```sh
pnpm cli status                          # root convenience script
apps/cli/bin/inteligir --help            # the bin itself
```

The bin (`bin/inteligir`) runs the source under tsx inside a checkout and the
esbuild bundle (`pnpm --filter @repo/cli build` → `dist/index.js`) when
packaged, so dev edits are never shadowed by a stale build.

## Server discovery

`INTELIGIR_SERVER_URL` wins. Otherwise the CLI REUSES the app's own config
module (`@repo/app/node/config` — node builtins + zod only, no server
machinery) to derive candidates exactly the way the app derives its listen
port: a configured `INTELIGIR_PORT`/managed-config port is dialed exactly; a
derived dev port is probed across the same upward range the server may have
bound (`DEV_PORT_PROBE_LIMIT`), then the installed prod default. Each
candidate must answer `/api/v1/health` with the contract body.

## Command surface

`vault list|read|write|rename|delete|mkdir|status|sync` ·
`search` (`tag:` terms pass through) · `backlinks` · `tags` ·
`thread list|new|send|show|wait|archive` · `interactions list|answer` ·
`status` · `guide`.

Exit codes: 0 success · 1 error (incl. a thread settling in error) ·
2 `thread wait` timeout · 3 no server reachable.

## Doc-sync discipline

The served manual (`apps/app/src/node/guide/cli-skill.ts`) must name every
leaf command — `src/__tests__/guide-covers-commands.test.ts` walks the real
command tree against it, and `json-flag-enforcement.test.ts` (bb's pattern,
MIT) walks the same tree for `--json`. Changing the command surface means
updating the manual in the same change; the tests make forgetting impossible.

## Tests

Unit suites run the real program object against an in-process server that
implements the SAME contract table (`typedRoutes` over `apiRoutes`, so the
fixture cannot drift) — output goldens, `thread wait` exit codes, discovery
resolution. The real-server integration lives in `e2e` (`cli-drive`): the
built bundle drives a booted instance under the scripted agent.
