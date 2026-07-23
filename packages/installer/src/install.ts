import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";

export type InstallCliFromGithubReleaseOptions = {
  /** GitHub org or user that owns the repo. */
  owner: string;
  /** Repository name. */
  repo: string;
  /** Release version (without the leading "v"), e.g. "0.22.5" → tag v0.22.5. */
  version: string;
  /**
   * Returns the release artifact filename for the current platform/arch.
   * Caller picks the naming convention upstream uses — some projects use LLVM
   * triples (`aarch64-apple-darwin`), agent-browser uses `darwin-arm64`, etc.
   * Return null if unsupported; install warns and skips.
   */
  artifactName: () => string | null;
  /** Binary name on disk under binDir. */
  binName: string;
  /** Install destination dir. Created if missing. */
  binDir: string;
  /**
   * Artifact shape:
   * - "tarball" (default): release asset is a .tar.gz; we extract a single
   *   binary from it.
   * - "binary": release asset IS the binary; we download + chmod it directly.
   * - "archive": release asset is a .tar.gz or .zip containing the binary plus
   *   sidecar files (e.g. a .wasm / .node next to it). We extract the whole
   *   archive into binDir, keeping every file, and chmod `binName`. Use this
   *   for binaries that do relative-path lookups for their sidecars.
   */
  artifactKind?: "tarball" | "binary" | "archive";
  /**
   * Path to the binary inside the tarball, when "tarball" kind. Defaults to
   * `binName` for flat archives. Set to e.g. `"peekaboo-macos-universal/peekaboo"`
   * when the archive nests its binary under a directory.
   */
  archiveBinPath?: string;
  /**
   * Integrity check:
   * - "checksums-txt": expects `checksums.txt` at the release root with
   *   `<hex>  <filename>` lines; we find the row matching our artifact.
   * - "inline-sha256": uses `sha256` (a per-artifact hash baked into this app).
   *   Stronger than the upstream-checksum mode — guards against a compromised
   *   release too, not just transport corruption. Use when the maintainer is
   *   willing to update the pinned hash on every dependency bump.
   */
  verify: "checksums-txt" | "inline-sha256";
  /**
   * Per-artifact SHA-256 hex hash, required when `verify === "inline-sha256"`.
   * Keys are artifact filenames as returned by `artifactName()`, values are
   * lowercase 64-char hex digests. The set of expected platforms is
   * intentionally explicit — running on a platform whose artifact isn't in
   * the map fails closed, instead of silently skipping verification.
   */
  sha256?: Record<string, string>;
  /**
   * Optional post-install hook — receives the installed binary path. Errors
   * are logged but do not throw; the binary is already in place.
   */
  postInstall?: (binPath: string) => Promise<void>;
  /**
   * Force a fresh download even when the requested version is already installed.
   * Used by an explicit "repair / reinstall" action to recover a corrupt or
   * partially-installed binary.
   */
  force?: boolean | undefined;
};

/**
 * Best-effort install of a CLI binary from a GitHub release.
 *
 * Stages the download/extract, atomically renames into place. Skips if a binary
 * at `${binDir}/${binName}` already reports the requested version via `--version`.
 * Failures are swallowed and logged — onboarding must succeed offline. The caller's
 * tool surfaces "binary not installed" later.
 *
 * NOTE on the checksums-txt mode: the checksum and the artifact share the
 * same origin, so it only guards against download corruption — not a
 * compromised upstream release.
 */
export async function installCliFromGithubRelease(
  opts: InstallCliFromGithubReleaseOptions,
): Promise<void> {
  try {
    await runInstall(opts);
  } catch (err) {
    console.error(`[install] ${opts.binName} install failed (continuing without it):`, err);
  }
}

/** Read a CLI's reported version (the first x.y.z in `--version`), or null if
 *  it's missing/unreadable. Exposed so callers can show installed-vs-pinned. */
export async function readCliVersion(binPath: string): Promise<string | null> {
  return getInstalledVersion(binPath);
}

async function getInstalledVersion(binPath: string): Promise<string | null> {
  if (!fs.existsSync(binPath)) return null;
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(binPath, ["--version"], { timeout: 5_000 }, (err, out) => {
        if (err) reject(err);
        else resolve(out);
      });
    });
    return stdout.match(/\d+\.\d+\.\d+/)?.[0] ?? null;
  } catch {
    return null;
  }
}

async function runInstall(opts: InstallCliFromGithubReleaseOptions): Promise<void> {
  const binPath = path.join(opts.binDir, opts.binName);
  if (!opts.force && (await getInstalledVersion(binPath)) === opts.version) return;

  const artifact = opts.artifactName();
  if (!artifact) {
    console.warn(
      `[install] ${opts.binName}: unsupported platform/arch ${process.platform}/${process.arch}`,
    );
    return;
  }

  const artifactKind = opts.artifactKind ?? "tarball";
  const archiveBinPath = opts.archiveBinPath ?? opts.binName;
  const tag = `v${opts.version}`;
  const releaseBaseUrl = `https://github.com/${opts.owner}/${opts.repo}/releases/download/${tag}`;
  const artifactUrl = `${releaseBaseUrl}/${artifact}`;
  const stagingDir = path.join(opts.binDir, `.${opts.binName}-staging-${process.pid}`);
  const stagedArtifactPath = path.join(stagingDir, artifact);
  // Where the binary lands after the download/extract step:
  // - "binary": the downloaded file IS the binary.
  // - "tarball": the single extracted entry at stagingDir/<archiveBinPath>.
  // - "archive": the binary sits among the extracted files at stagingDir/<binName>.
  const stagedBinPath =
    artifactKind === "binary"
      ? stagedArtifactPath
      : path.join(stagingDir, artifactKind === "archive" ? opts.binName : archiveBinPath);

  fs.mkdirSync(opts.binDir, { recursive: true });
  fs.mkdirSync(stagingDir, { recursive: true });
  console.log(`[install] downloading ${opts.binName} from ${artifactUrl}`);

  try {
    if (opts.verify === "checksums-txt") {
      const expectedSha = await fetchExpectedSha(releaseBaseUrl, artifact);
      await downloadVerified(artifactUrl, stagedArtifactPath, expectedSha);
    } else {
      const expectedSha = opts.sha256?.[artifact];
      if (!expectedSha || !/^[0-9a-f]{64}$/.test(expectedSha)) {
        throw new Error(
          `inline-sha256: no valid pinned hash for ${artifact} (have ${
            opts.sha256 ? Object.keys(opts.sha256).join(", ") : "no map"
          })`,
        );
      }
      await downloadVerified(artifactUrl, stagedArtifactPath, expectedSha);
    }

    if (artifactKind === "tarball") {
      await extractArchive(stagedArtifactPath, stagingDir, archiveBinPath);
    } else if (artifactKind === "archive") {
      await extractArchive(stagedArtifactPath, stagingDir);
      fs.rmSync(stagedArtifactPath, { force: true });
    }

    fs.chmodSync(stagedBinPath, 0o755);

    if (artifactKind === "archive") {
      // Multi-file artifact: move every extracted file into binDir (binary +
      // its sidecars), overwriting any prior install. Not atomic per-file, but
      // matches how these binaries expect their sidecars laid out beside them.
      for (const entry of fs.readdirSync(stagingDir)) {
        const dest = path.join(opts.binDir, entry);
        fs.rmSync(dest, { recursive: true, force: true });
        fs.renameSync(path.join(stagingDir, entry), dest);
      }
    } else {
      // renameSync is atomic on the same filesystem — the old binary is never
      // partially overwritten.
      fs.renameSync(stagedBinPath, binPath);
    }
    console.log(`[install] installed ${opts.binName} to ${binPath}`);
  } finally {
    try {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  if (opts.postInstall) {
    try {
      await opts.postInstall(binPath);
    } catch (err) {
      console.error(`[install] ${opts.binName} post-install failed:`, err);
    }
  }
}

async function fetchExpectedSha(releaseBaseUrl: string, artifact: string): Promise<string> {
  const url = `${releaseBaseUrl}/checksums.txt`;
  const resp = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(60_000) });
  if (!resp.ok) {
    throw new Error(`checksum fetch failed: ${resp.status} ${resp.statusText}`);
  }
  const text = await resp.text();

  // checksums.txt is `<hex>  <filename>` lines, one entry per release
  // artifact: find the line for our artifact and take its first
  // whitespace-delimited token.
  const expectedSha = text
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .find(([, name]) => name === artifact)?.[0]
    ?.toLowerCase();

  if (!expectedSha || !/^[0-9a-f]{64}$/.test(expectedSha)) {
    throw new Error(`checksum for ${artifact} not found / invalid in ${url}`);
  }
  return expectedSha;
}

async function downloadVerified(url: string, dest: string, expectedSha: string): Promise<void> {
  const resp = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(60_000) });
  if (!resp.ok || !resp.body) {
    throw new Error(`artifact fetch failed: ${resp.status} ${resp.statusText}`);
  }

  const hash = createHash("sha256");
  await pipeline(
    resp.body,
    async function* (source) {
      for await (const chunk of source) {
        if (!isHashableChunk(chunk)) throw new Error("download stream yielded non-binary chunk");
        hash.update(chunk);
        yield chunk;
      }
    },
    await openWriteStream(dest),
  );

  const actualSha = hash.digest("hex");
  if (actualSha !== expectedSha) {
    throw new Error(`checksum mismatch: expected ${expectedSha}, got ${actualSha}`);
  }
}

function isHashableChunk(chunk: unknown): chunk is NodeJS.ArrayBufferView {
  return ArrayBuffer.isView(chunk);
}

/**
 * Create the destination write stream and wait for its fd to open before
 * piping into it. createWriteStream opens lazily; if the download stream dies
 * before the open completes, the staging cleanup in runInstall races the
 * in-flight open — the open re-creates the partial file inside the directory
 * being removed, rmdir fails ENOTEMPTY, and a stale staging dir leaks. With
 * the fd open up front, cleanup after a failed download is deterministic.
 */
async function openWriteStream(dest: string): Promise<fs.WriteStream> {
  const out = fs.createWriteStream(dest);
  await once(out, "open");
  return out;
}

/**
 * Extract an archive into `outDir`. Uses `tar`, which (via libarchive/bsdtar on
 * macOS and Windows) handles both `.tar.gz`/`.tgz` (Linux releases) and `.zip`
 * (macOS/Windows releases) — avoiding a dependency on `unzip`, which isn't on
 * the default Windows PATH. When `entryName` is given, extract only that entry.
 *
 * `.tar.gz` is read with `-xzf` (gzip); `.zip` with `-xf` (auto-detected) since
 * forcing gzip on a zip fails. Linux releases are always `.tar.gz`, and GNU tar
 * there can't read zip — but no Linux artifact is a zip, so that's never hit.
 */
function extractArchive(archivePath: string, outDir: string, entryName?: string): Promise<void> {
  const isZip = /\.zip$/i.test(archivePath);
  const args = [
    isZip ? "-xf" : "-xzf",
    archivePath,
    "-C",
    outDir,
    ...(entryName ? [entryName] : []),
  ];
  return new Promise((resolve, reject) => {
    execFile("tar", args, { timeout: 60_000 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
