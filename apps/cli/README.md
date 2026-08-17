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

`INTELIGIR_SERVER_URL` wins, trusted without a probe — you named it, you own
it (`inteligir status` prints the data dir and vault it bound to, and says
`explicit`). Otherwise the CLI REUSES the app's own config module
(`@repo/app/node/config` — node builtins + zod only, no server machinery) to
derive candidates exactly the way the app derives its listen port: a
configured `INTELIGIR_PORT`/managed-config port is dialed exactly; a derived
dev port is probed across the same upward range the server may have bound
(`DEV_PORT_PROBE_LIMIT`), then the installed prod default.

A probed candidate must clear two gates, not one: `/api/v1/health` answering
the contract body, AND `/api/v1/system/status` reporting the same `dataDir`
this checkout's config resolution derived. The second is what stops a
NEIGHBOURING checkout's dev server — a real inteligir answering an earlier
port in the probe range — from being adopted, which would write notes into
someone else's vault. A foreign responder is skipped; exhausting the range
exits 3 naming the conflict.

## Command surface

`vault list|read|write|rename|delete|mkdir|status|sync` ·
`search` (`tag:` terms pass through) · `backlinks` · `tags` ·
`thread list|new|send|show|wait|archive` · `interactions list|answer` ·
`proposals list|show|accept|reject` · `status` · `guide`.

Exit codes: 0 success · 1 error (incl. a thread settling in error) ·
2 `thread wait` timeout · 3 no server reachable.

**Every command checks the HTTP status before printing** — `requireOk`
(`src/output.ts`) is the only way a body is reached, and it returns the
SUCCESS member of hono's response union, so a command cannot call `.json()`
on a refusal. Failures go to stderr with stdout left empty; under `--json`
the failure itself is `{"error","message"}` JSON on stderr, carrying the
server's own error class where there is one.

## Output

`src/output.ts` is the whole output layer, and which sink a line takes is
decided by what the line IS. Anything derived from vault or server CONTENT —
file bytes, snippets, diffs, timelines, the manual — is written raw
(`writeOut`/`writeLines`), because consola's reporter rewrites `backtick` and
`_underscore_` spans in every message it formats and a note's own text carries
both. Prose the CLI wrote itself goes through consola (`out.success`,
`out.info`, `out.box`, `out.error`). `--json` uses neither: `outputJson`
writes the document and returns, so stdout stays one JSON value without any
command having to remember it.

The consola instance pins its reporter, its level and its throttle rather than
letting consola derive them, because all three differ under `NODE_ENV=test` —
the derived reporter prefixes every line with `[log]` and the derived level
silences `.log`, `.info` and `.success` outright, so the goldens would pin
bytes no user ever sees.

## Agent reachability

The agent runs `inteligir` as a BARE command, so the app resolves the CLI's
bin directory (`apps/app/src/node/agent/agent-shell-env.ts`) and PREPENDS it
to the PATH the codex runtime injects into the agent's shell, alongside
`INTELIGIR_SERVER_URL`. If no binary resolves, the PATH entry is omitted AND
the session instructions drop the CLI pointer — instructions never promise a
command the shell cannot run. The e2e `cli-drive` scenario invokes the bare
name through that same composed env.

## Doc-sync discipline

The served manual (`apps/app/src/node/guide/cli-skill.ts`) must name every
leaf command AND every flag those leaves accept —
`src/__tests__/guide-covers-commands.test.ts` walks the real citty tree
against the guide's rendered bytes (not its source: a comment used to satisfy
it). `json-flag-enforcement.test.ts` (bb's pattern, MIT) walks the same tree
and EXECUTES every leaf: JSON on stdout under `--json`, and non-zero exits
with empty stdout when the server answers 400 or 500.

Both read the tree through `src/command-tree.ts`, which is shipped rather than
test-only: `--help` resolves the deepest command through the same walk, and so
does the gate that refuses a flag the command never declared. citty parses
with node's `parseArgs` in NON-strict mode, so without that gate `vault write
notes/a.md --contentt x` would silently read stdin and exit 0.

## Tests

Unit suites run the real program object against an in-process server that
implements the SAME contract table (`typedRoutes` over `apiRoutes`, so the
fixture cannot drift) — output goldens, `thread wait` exit codes, discovery
resolution. The real-server integration lives in `e2e` (`cli-drive`): the
built bundle drives a booted instance under the scripted agent.
