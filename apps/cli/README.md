# inteligir — the binary

One program, two modes.

**`inteligir serve` IS the product's server**: it opens the vault (a git repo
of markdown), builds and maintains the knowledge index, drives the agent, and
answers one oRPC API plus the invalidation socket. Nothing else in the repo
runs a server.

**Every other verb is a CLIENT** of a running one, over that same contract
(`@repo/api/local`). Agent-facing by design: every leaf takes `--json`, the
server serves the manual (`inteligir guide`), and the agent runtime prepends
this bin directory to the PATH of the shells it spawns — so a model drives the
product by typing `inteligir …` in bash.

## Running it

```sh
inteligir serve --open      # zero-install: `npx inteligir serve --open`
inteligir open              # another signed-in browser tab on the running server
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
`<dataDir>/server.json` at `0600` — `{ port, token, vaultDir, pid, version }` —
and removes it on ordered shutdown, if the row is still its own. A client reads
it and sends `Authorization: Bearer <token>`. A verb refuses a server whose
`version` is not its own release (`SERVER_VERSION_MISMATCH`, exit 3), a row
with none included: `/local` may break between releases, and this binary
installs and updates apart from the desktop app. Which process may serve a data
dir at all is a different file: `serve` holds `<dataDir>/serve.lock` from before
it composes until after its db closes, so a second boot is refused even while
the first has not published its row yet.

A browser cannot send that header, and it never sees the bearer. The link
`serve` prints (and opens, under `--open`) carries a single-use handoff that the
server trades once for a session cookie of the browser's own, answering with the
same URL minus the handoff; `inteligir open` and the desktop's Open in Browser
mint a fresh one over `system.browserHandoff`, which a server with no UI (an
unbuilt checkout) refuses as `NOT_FOUND`, since its link would land on a 404. A
plain GET sets no cookie and gets a signed-out page naming those ways in, never
the workspace, and a request naming any host but `127.0.0.1` or `localhost` is
refused before it reaches a route.

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

`serve` · `open` · `vault
list|read|history|revision|restore|write|rename|delete|deleted|mkdir|new-id|attachments|open|status|sync`
· `search` (`tag:` terms pass through) · `matches` · `backlinks` · `related` ·
`unlinked` · `problems` · `tags` · `tag notes|rename` · `action
list|new|send|show|stop|wait|archive|changes|undo` · `comment list|add|reply|resolve|remove` ·
`interactions list|answer` · `agents list|default` · `folders
list|add|remove` · `cloud status|login|sync` · `status` · `guide`.

Exit codes: 0 success · 1 error (including an action settling in error) ·
2 `action wait` timeout · 3 no server reachable · 4 `action wait
--until-input` met an approval · 130 interrupted. Each class the CLI raises
itself carries its exit code in one table, `CLI_FAILURE_EXIT_CODES` in
`src/cli-error.ts`, so a class cannot leave with another's code, and
`guide-covers-commands.test.ts` holds the served guide to naming every row.

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

Under `INTELIGIR_THREAD_ID` every call names its thread in an
`x-inteligir-thread` header (`src/server/agent-thread-header.ts`), so a note the
agent writes, renames, re-tags or attaches through the CLI lands in that turn's
agent-authored commit, like an edit its own tools reported, rather than in the
next auto-commit. The header is attribution, not authority: the bearer already
admitted the call, and a thread with no turn running records nothing.

## Doc-sync discipline

The served manual (`src/server/guide/cli-skill.ts`) must name every leaf
command AND every flag those leaves accept —
`src/__tests__/guide-covers-commands.test.ts` walks the real citty tree against
the guide's rendered bytes (not its source: a comment used to satisfy it), and
against § Command surface above, which must list every leaf and no other.
`json-flag-enforcement.test.ts` (bb's pattern, MIT) walks the same tree and
EXECUTES every leaf: JSON on stdout under `--json`, and non-zero exits with
empty stdout when the server refuses.

Both read the tree through `src/command-tree.ts`, which is shipped rather than
test-only: `--help` resolves the deepest command through the same walk, and so
does the gate that refuses what citty would drop — a flag the command never
declared, long or short, and a word past its last positional. citty parses with
node's `parseArgs` in NON-strict mode and binds positionals in order, so
without that gate `vault write notes/a.md --contentt x` would silently read
stdin and exit 0, and `search two words` would search for `two`. Only the words
before `--` are counted: `--` ends the options, so what follows reaches the leaf
as an operand however it is spelled (`vault read -- -draft.md`). The walk is
exact only while no command with subcommands declares args, and the
enforcement test holds every group to that.

## What ships

`dist/index.js` and the `dist/chunk-*.js` beside it are the whole program,
bundled by esbuild — every workspace package is inlined, because they export
TypeScript source a published install cannot resolve. What stays external is
what a bundler cannot swallow: the two NATIVE modules (`better-sqlite3` and
`@parcel/watcher`, both N-API prebuilds) and the two ACP adapters, which are
resolved at runtime with `require.resolve` and spawned as children.

The bundle is SPLIT at every dynamic import, so a client verb never parses the
server `serve` loads. The chunks sit FLAT beside the entry: `src/paths.ts` and
the two sibling lookups below resolve from whichever file they landed in, so
every file in `dist/` has to answer them the same way.

Three bundles cannot ride inside the entry and each says why beside itself: the
vault watcher is a CHILD PROCESS, the stdio host runs each ACP adapter in the
desktop shell, and the knowledge projector is a WORKER THREAD, so each needs a
real file on disk resolved as a sibling of the running entry. In a checkout the
worker runs its `.ts` source under tsx's hook instead
(`src/server/worker-entry.ts`).

**Who starts a node child depends on who runs the server**
(`src/server/child-host/node-children.ts`). Run by node (`serve`, npx, a suite),
it forks the watcher and spawns each adapter with `child_process` over its own
`process.execPath`. Run by the desktop shell, it is an Electron utility process:
its `execPath` is Electron's helper, which the packaged binary's `runAsNode`
fuse keeps from running JavaScript, and a utility process cannot fork one of its
own. So it asks main over `process.parentPort` (`fork-broker-wire.ts`, parsed on
both ends), main forks the child as a utility process of its own and hands each
side one end of a MessageChannel, and the two talk directly. The watcher's IPC
rides that port; an adapter speaks ACP over stdin and stdout, which a utility
process cannot be given, so `stdio-port-host` carries its three streams over the
port as frames and `brokered-adapter.ts` stands in for its `ChildProcess`. codex
is the one adapter that runs a node script of its own (its bundled launcher,
through `process.execPath`), so the harness row names the native binary that
launcher would start as `CODEX_PATH`.

A vendor's own binary is native, so the server runs it itself. Whether an agent
is signed in is the vendor's answer (`claude auth status --json`, `codex login
status`) over its shared store (`~/.claude`, `~/.codex`), so a machine already
signed in needs nothing more, asked through `src/server/agents/vendor-process.ts`,
the one vendor spawn policy: the bundled binary alone, never PATH's; the data
dir as cwd, never the vault; the harness's `envOmit` dropped; a deadline that
kills the process group. `vendor-accounts.ts` shares one probe between
concurrent asks and keeps its answer for 10s. Signing in is the vendor's own
too (`agent-sign-in.ts`): claude's login is that binary run under the same
policy, codex's is its adapter's `authenticate`, one sign-in per server, and a
cancel, the ceiling or shutdown ends it. Nothing about the agent reads
PATH: a send is refused up front only when the thread's runtime is missing
from the install, and a signed-out vendor refuses the session itself.

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
tarball: the layout (every file the build emitted, chunks included), the
execute bit, the licence texts, a boot, the two native modules, a graceful
SIGTERM. The e2e `built-cli-boot` scenario boots the same bundle from the
checkout on every CI run.

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
