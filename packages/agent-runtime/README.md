# `@repo/agent-runtime`

Filesystem + install primitives for the Inteligir desktop agent. Pure Node, **zero Electron deps** — anything that needs `app.isPackaged` or `process.resourcesPath` belongs in `packages/desktop/`, not here.

## What's here

```
src/
  seed.ts     seedDirectory, seedFile (atomic via COPYFILE_EXCL), prependPath
  install.ts  installCliFromGithubRelease — fetch + verify + atomic rename
  run-cli.ts  runCli — spawn an installed binary with our pi-extension conventions
```

No `index.ts` barrel. Consumers import directly:

```ts
import { prependPath, seedDirectory, seedFile } from "@repo/agent-runtime/seed";
import { installCliFromGithubRelease } from "@repo/agent-runtime/install";
import { runCli } from "@repo/agent-runtime/run-cli";
```

## `installCliFromGithubRelease`

Generic GitHub-release CLI installer. Caller supplies identity + an `artifactName()` that picks the release asset for the current platform; the library does fetch + verify + atomic-rename.

Two artifact shapes are supported because upstream conventions diverge:

```ts
// Tarball (default) — release ships a .tar.gz, sha256 sidecar verifies download.
// archiveBinPath points at the binary when the tarball nests it under a dir.
await installCliFromGithubRelease({
  owner: "openclaw",
  repo: "Peekaboo",
  version: "3.0.0",
  binName: "peekaboo",
  binDir: "/Users/me/.inteligir/bin",
  archiveBinPath: "peekaboo-macos-universal/peekaboo",
  artifactName: () => (process.platform === "darwin" ? "peekaboo-macos-universal.tar.gz" : null),
});

// Plain binary — release ships the binary itself, version-check verifies it
await installCliFromGithubRelease({
  owner: "vercel-labs",
  repo: "agent-browser",
  version: "0.26.0",
  binName: "agent-browser",
  binDir: "/Users/me/.inteligir/bin",
  artifactKind: "binary",
  verify: "version-check",
  artifactName: () =>
    process.platform === "darwin" && process.arch === "arm64" ? "agent-browser-darwin-arm64" : null,
  postInstall: async (binPath) => {
    // run a one-time bootstrap (e.g. install a browser runtime)
    await runOnce(binPath, ["install"]);
  },
});
```

### Knobs

| Knob           | Default            | Why                                                                                                |
| -------------- | ------------------ | -------------------------------------------------------------------------------------------------- |
| `tagPrefix`    | `"v"`              | Some Go projects tag bare versions; set `""` to opt out                                            |
| `artifactKind` | `"tarball"`        | Set `"binary"` when the release asset IS the bin                                                   |
| `verify`       | `"sha256-sidecar"` | Set `"version-check"` when upstream doesn't publish checksums                                      |
| `postInstall`  | none               | Hook for one-time post-install steps (browser runtime, plugin DB, etc.). Errors logged, not thrown |

Why `artifactName` is caller-supplied: every upstream uses a different filename convention (LLVM triples, `darwin_amd64`, `darwin-arm64`, `macOS_arm64`…). Letting the caller compute it keeps this library out of the matching game.

### Behavior

- Skips install if `${binDir}/${binName} --version` already reports `version`.
- Stages download/extract in `${binDir}/.${binName}-staging-${pid}/`. Atomic-renames into place. Mid-flight failure can't corrupt the currently-installed binary.
- `sha256-sidecar` mode: only guards download corruption — same origin as the artifact, no protection against compromised upstream.
- `version-check` mode: weaker, but the only option when upstream doesn't publish checksums. Probes the staged binary before rename so a wrong-arch download doesn't get installed.
- Swallows failures with a `console.error`. Onboarding must succeed offline; the calling tool surfaces "binary not installed" later.

## `runCli`

Spawns an installed binary (`execFile`, no shell) and captures
`{ stdout, stderr, code }`, applying the conventions every pi-extension tool
wrapper relies on:

- **ENOENT → a tool-named error.** A missing binary rejects with
  `notFoundMessage` (e.g. `"peekaboo binary not installed"`) instead of leaking
  the raw spawn error, so the tool can surface an actionable string.
- **Bounded.** `timeoutMs` (SIGTERM on overrun) and `maxBuffer` (cap on captured
  output) are required — a runaway CLI can't hang or OOM the agent.
- **Optional `stdin`** is piped to the child and the stream closed.

```ts
const { stdout, code } = await runCli(binPath, ["--json", "see"], {
  timeoutMs: 30_000,
  maxBuffer: 8 * 1024 * 1024,
  notFoundMessage: "peekaboo binary not installed",
});
```

Pairs with `installCliFromGithubRelease`: install puts the binary on disk and on
PATH, `runCli` invokes it.

## When to add to this package

✅ **Yes** — when:

- The primitive has zero Electron dependency.
- It's pure infrastructure: filesystem, network download, PATH manipulation, checksum verification.
- A future consumer (CLI, headless runner, test harness) might want it.

❌ **No** — when:

- It needs `app.isPackaged`, `process.resourcesPath`, `BrowserWindow`, etc. → `packages/desktop/src/main/`
- It's a pi extension's tool registration → `packages/host/src/agent/<name>/extension.ts`
- It's specific to one integration's quirks (e.g. an extension's OAuth client_secret seed). Keep generic primitives here, glue in the consumer.
