# @repo/installer

Generic CLI provisioning for node hosts: checksum-verified GitHub-release
binary install, first-launch resource seeding, and a hardened `execFile`
runner.

## Why it exists

Runs in node only (agent host / desktop main side — never renderer or
Worker). A **leaf**: zero workspace deps, zero runtime deps, and it knows
nothing about pi or the app — it takes owner/repo/version/hash and does the
mechanics. Real consumers: `@repo/agent` (the `peekaboo/` and `browser/`
extension bundles install + run their CLIs through it; `setup.ts` uses
`seed`/`readCliVersion`) and `@repo/connectors` (`executor-daemon.ts`
installs the executor binary). Keeping it below both means the agent and
connectors share one install path without an agent→connectors edge.

## Layout

```
src/
  install.ts    # installCliFromGithubRelease + readCliVersion — download,
                # verify, extract, atomic rename into binDir
  run-cli.ts    # runCli — execFile wrapper: timeout, maxBuffer, stdin,
                # ENOENT → notFoundMessage, exit code always numeric
  seed.ts       # seedDirectory / seedFile (COPYFILE_EXCL) / prependPath —
                # first-launch copy-if-absent provisioning
```

Each module is its own export (`@repo/installer/install`, `/run-cli`,
`/seed`) — no barrel.

## Invariants

- **Verify modes are exactly `checksums-txt` | `inline-sha256`.**
  `checksums-txt` reads `<hex>  <filename>` rows from the release's
  `checksums.txt` — same origin as the artifact, so it guards transport
  corruption only. `inline-sha256` pins per-artifact hashes in the app and
  also guards a compromised upstream release; an artifact missing from the
  pinned map **fails closed**, never skips verification.
- **Install is best-effort**: `installCliFromGithubRelease` swallows and
  logs failures — onboarding must succeed offline. The caller's tool
  surfaces "binary not installed" later (via `runCli`'s ENOENT mapping).
- **Never clobber on failure**: download + extract happen in a staging dir;
  the single-binary path lands via atomic `renameSync`. A failed checksum
  leaves any existing install untouched. The `archive` kind (binary +
  sidecars) moves files individually — not atomic per-file, by design.
- **Idempotent**: skipped when `${binDir}/${binName} --version` already
  reports the pinned version; `force: true` is the repair/reinstall path.
- Three artifact kinds: `tarball` (default, extract one entry —
  `archiveBinPath` for nested layouts), `binary` (asset IS the binary),
  `archive` (extract everything, for sidecar-relative binaries). Extraction
  shells out to `tar` (bsdtar reads zips too — no `unzip` dependency).
- Seeding never overwrites: `seedFile` uses `COPYFILE_EXCL` (no TOCTOU
  window — matters for OAuth secrets under concurrent launches);
  `seedDirectory` is a no-op when dest exists, so user edits survive
  relaunch. `prependPath` mutates the calling process's PATH so
  agent-spawned subprocesses find `~/.inteligir/bin`.
- `runCli` resolves on any normal exit — non-zero `code` is a value, not a
  throw; string error codes coerce to `1`.

## Testing

```bash
pnpm --filter @repo/installer test
```

`install.test.ts` pins the fail-closed matrix against a mocked `fetch` +
real tar/fs: checksum mismatch, mid-stream death, corrupt-archive-with-good-
checksum, 404s, unpinned/malformed inline hashes, no-clobber on failed
verify, version-match network skip, `force` re-download, sidecar
replacement, and postInstall error containment. `seed.test.ts` pins the
never-overwrite + idempotence contracts. Shell-script fakes can't exec on
Windows; the suite targets the macOS/ubuntu CI matrix.
