# inteligir — the binary

One program, two modes.

**`inteligir serve` IS the product's server**: it opens the vault (a git repo
of markdown), builds and maintains the knowledge index, drives the agent, and
answers one oRPC API plus the invalidation and dictation sockets. Nothing else
in the repo runs a server.

**Every other verb is a CLIENT** of a running one, over that same contract
(`@repo/api/local`). Agent-facing by design: every leaf takes `--json`, the
server serves the manual (`inteligir guide`), and the agent runtime prepends
this bin directory to the PATH of the shells it spawns — so a model drives the
product by typing `inteligir …` in bash.

## Running it

```sh
inteligir serve --open      # zero-install: `npx inteligir serve --open`
pnpm cli status             # in a checkout, against this checkout's instance
apps/cli/bin/inteligir --help
```

`serve` takes `--port`, `--data-dir`, `--vault` and `--open`; each resolves to
the same `INTELIGIR_*` variable the config layer reads, so a flag can never
mean something the environment cannot.

The bin (`bin/inteligir`) runs the source under tsx inside a checkout and the
esbuild bundle (`pnpm package:cli` → `dist/index.js`) when packaged, so dev
edits are never shadowed by a stale build. Node resolves that file's realpath
through the `node_modules/.bin/inteligir` symlink an installed package is
reached by, so `import.meta.url` names the package's own bin dir with no manual
following — the directory holding the link has no `dist/` beside it.

## Which server, and may I talk to it

Both answers come out of ONE file. On boot the server writes
`<dataDir>/server.json` at `0600` — `{ port, token, vaultDir, pid }` — and
removes it on ordered shutdown. A client reads it and sends
`Authorization: Bearer <token>`.

There is no probing. A derived dev port may have been probed upward at bind, so
a client that dialled the derived value could reach a NEIGHBOURING checkout's
server, and writing a note into someone else's vault is a silent, destructive
wrong answer. The file names the port that actually answered, so the ambiguity
has nowhere to live — and a squatter holding the port cannot have written the
file, so a wrong responder is refused rather than adopted.

WHICH data dir is still the client's own question, and it reuses the server's
resolution (`src/server/config.ts`) rather than re-deriving it: env →
`<dataDir>/config.json` → the per-checkout default, where the checkout is
walked up to from wherever the command started. That last part is what lets
`pnpm dev` (which runs from `apps/desktop`) and `pnpm cli …` (run from wherever
you stand) name the same instance.

There is deliberately NO "point the CLI at a URL" escape hatch. Under a bearer
model, naming a URL is naming somewhere to SEND A CREDENTIAL — and the token
would still have to come from a local data dir, so the two halves could
disagree. `INTELIGIR_DATA_DIR` names the instance instead, which is also what
agent shells are given.

## Command surface

`serve` · `vault list|read|write|rename|delete|mkdir|status|sync` ·
`search` (`tag:` terms pass through) · `backlinks` · `related` · `tags` ·
`action list|new|send|show|wait|archive` · `comment` · `interactions
list|answer` · `connectors` · `folders` · `trash` · `sync` · `status` ·
`guide`.

Exit codes: 0 success · 1 error (including an action settling in error) ·
2 `action wait` timeout · 3 no server reachable.

**A refusal can never be printed as an answer.** The oRPC client throws on a
typed error, and `src/program.ts` turns that into a failure on stderr with the
server's own error code — stdout is left empty. Under `--json` the failure
itself is `{"error","message"}` JSON on stderr.

## Output

`src/output.ts` is the whole output layer, and which sink a line takes is
decided by what the line IS. Anything derived from vault or server CONTENT —
file bytes, snippets, diffs, timelines, the manual — is written raw
(`writeOut`/`writeLines`), because consola's reporter rewrites `backtick` and
`_underscore_` spans in every message it formats and a note's own text carries
both. Prose the CLI wrote itself goes through consola (`out.success`,
`out.info`, `out.box`, `out.error`). `--json` uses neither: `outputJson` writes
the document and returns, so stdout stays one JSON value without any command
having to remember it.

The consola instance pins its reporter, its level and its throttle rather than
letting consola derive them, because all three differ under `NODE_ENV=test` —
the derived reporter prefixes every line with `[log]` and the derived level
silences `.log`, `.info` and `.success` outright, so the goldens would pin
bytes no user ever sees.

## Agent reachability

The agent runs `inteligir` as a BARE command, so the server resolves this bin
directory (`src/server/agents/agent-shell-env.ts`) and PREPENDS it to the PATH
it injects into the agent's shell, alongside `INTELIGIR_DATA_DIR` (which names
the instance without handing a child the credential) and
`INTELIGIR_THREAD_ID`. The directory is CHECKED for an executable rather than
assumed: npm strips the execute bit from a packed file it does not name in
`bin`, and the failure mode is the command silently disappearing from a
model's PATH. If nothing resolves, the PATH entry is omitted AND the session
instructions drop the CLI pointer — instructions never promise a command the
shell cannot run. The e2e `cli-drive` scenario invokes the bare name through
that same composed env.

## Doc-sync discipline

The served manual (`src/server/guide/cli-skill.ts`) must name every leaf
command AND every flag those leaves accept —
`src/__tests__/guide-covers-commands.test.ts` walks the real citty tree against
the guide's rendered bytes (not its source: a comment used to satisfy it).
`json-flag-enforcement.test.ts` (bb's pattern, MIT) walks the same tree and
EXECUTES every leaf: JSON on stdout under `--json`, and non-zero exits with
empty stdout when the server refuses.

Both read the tree through `src/command-tree.ts`, which is shipped rather than
test-only: `--help` resolves the deepest command through the same walk, and so
does the gate that refuses a flag the command never declared. citty parses with
node's `parseArgs` in NON-strict mode, so without that gate `vault write
notes/a.md --contentt x` would silently read stdin and exit 0.

## What ships

`dist/index.js` is the whole program, bundled by esbuild — every workspace
package is inlined, because they export TypeScript source a published install
cannot resolve. What stays external is what a bundler cannot swallow: the three
NATIVE modules (`better-sqlite3`, `@parcel/watcher`, `sherpa-onnx-node`, all
N-API prebuilds) and the two ACP adapters, which are resolved at runtime with
`require.resolve` and spawned as children.

Two bundles cannot ride inside the entry and each says why beside itself: the
vault watcher is a forked CHILD PROCESS and the transcriber is a WORKER THREAD,
so both need a real file on disk resolved as a sibling of the running entry.

Four trees are staged as CONTENT rather than code: the committed SQL
migrations, the dialect skills the agent reads with its own shell, the
workspace UI — the desktop renderer's build — which `serve` answers over plain
HTTP so `--open` lands a browser in the product, and `tools/licenses` as
`dist/licenses`, because the repo-root path no `files` glob can name is where
the vendored sources' notices live. The migrations resolve SOURCE-FIRST — the
staged copy answers only where `@repo/db` cannot be resolved, because `dist/`
is the ordinary state of a worked-in checkout and a frozen snapshot would
migrate a dev database past what the running code carries. The UI stays
staged-first, which is why the two resolvers read differently.

`pnpm smoke:cli` proves all of it against a real `npm install` of the packed
tarball: the layout, the execute bit, the licence texts, a boot, the three
native modules, a graceful SIGTERM.

The published surface is the bin and nothing else: `publishConfig.exports` is
`{}`, so pnpm rewrites the manifest on the way out. The subpath map in
`package.json` is a WORKSPACE seam — apps/desktop, tools/e2e and
tools/repo-guards compile against `inteligir/server/*` — and it is unshippable
as written, since those modules target `src/`, which `files` does not carry,
and import devDependencies and unpublished `@repo/*` packages. Advertising a
subpath a real install answers with ERR_MODULE_NOT_FOUND is the failure this
closes.

## Tests

Unit suites run the real program object against an in-process server built from
the SAME contract (so the fixture cannot drift) — output goldens, `action wait`
exit codes, discovery resolution. The server's own suites sit under
`src/server/__tests__/`. The real-server integration lives in `e2e`
(`cli-drive`): the CLI drives a booted instance under the scripted agent.
