# inteligir

An AI-native notes app — Obsidian with an agent. Everything runs on your
machine: your notes are plain markdown files in a folder you own, versioned with
git.

```bash
npx inteligir
```

That boots the server, prints the URL and opens it. Your vault is created at
`~/Inteligir` on first run; the database and settings live in `~/.inteligir`.

## Options

```
--port <n>         TCP port for the local server (default 4664)
--data-dir <path>  Where the database and settings live (default ~/.inteligir)
--vault <path>     The vault: your markdown files (default ~/Inteligir)
--no-open          Do not open a browser once the server is listening
-v, --version      Print the version and exit
-h, --help         Print this help and exit
```

Relative paths are resolved against the directory you ran the command in.
`^C` stops it: the server flushes its pending vault commit and closes the
database before it exits.

## What is in the package

| Path                 | What                                                          |
| -------------------- | ------------------------------------------------------------- |
| `dist/inteligir.mjs` | The `inteligir` bin — this launcher                           |
| `dist/apps/app/`     | The product: the Node server bundle, the SPA, the migrations  |
| `dist/apps/cli/`     | The agent-facing CLI, also exposed as the `inteligir-cli` bin |

The two directories are **siblings on purpose**. The server resolves the CLI by
walking up from its own bundle, and injects that directory onto the agent's
`PATH` so a model can drive the product by typing `inteligir …` in its shell.
Flattening the tree makes that resolution return nothing and the capability
disappears with no error anywhere — `apps/launcher/scripts/build.mjs` and
`apps/app/src/node/agent/agent-shell-env.ts` are the two sides of it.

`better-sqlite3` and `@parcel/watcher` are runtime dependencies rather than
bundled, because they are native: npm installs the prebuild for your platform.
Everything else is inlined at build time.

## Two programs, two names

`inteligir` **runs** the app. `inteligir-cli` **drives** a running one —
`inteligir-cli vault list`, `inteligir-cli search …`. Inside an agent's shell
the CLI is on `PATH` under its own name, `inteligir`, which is what the agent's
instructions promise it.

## Supported platforms

| Surface                      | macOS | Linux | Windows                      |
| ---------------------------- | ----- | ----- | ---------------------------- |
| `npx inteligir`              | yes   | yes   | yes                          |
| `inteligir-cli`              | yes   | yes   | yes (npm generates the shim) |
| `inteligir` on an agent PATH | yes   | yes   | **no** — see below           |
| The desktop app              | yes   | no    | no                           |

Both bins are node entries, so npm builds a working `.cmd` for each on Windows.
What does not work there is the agent's PATH injection: the server puts
`dist/apps/cli/bin` on the agent shell's PATH and the agent types `inteligir`,
which cmd cannot resolve without an extension. On Windows an agent can still
drive the product by calling `inteligir-cli`.

## Developing

This package is built, not written by hand beyond `src/`: `scripts/build.mjs`
bundles the launcher and stages the app and CLI trees from their workspaces.

```bash
pnpm package:app      # turbo run build --filter=inteligir
pnpm smoke:package    # pack, install into a scratch prefix, boot, probe, stop
```

The smoke uses `pnpm pack`, never `npm pack`: the `catalog:` protocol on the two
native dependencies is a pnpm workspace fact and only pnpm rewrites it on the
way out — which is also why publishing must be `pnpm publish`.
