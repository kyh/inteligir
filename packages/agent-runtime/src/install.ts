import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";

export type InstallCliFromGithubReleaseOptions = {
  /** GitHub org or user that owns the repo. */
  owner: string;
  /** Repository name. */
  repo: string;
  /** Release version (without tag prefix), e.g. "0.22.5". */
  version: string;
  /** Tag prefix on the GitHub release. Default "v" (so `version` 0.22.5 → tag v0.22.5). */
  tagPrefix?: string;
  /**
   * Returns the release artifact filename for the current platform/arch.
   * Caller picks the naming convention upstream uses — gws uses LLVM triples
   * (`aarch64-apple-darwin`), agent-browser uses `darwin-arm64`, etc.
   * Return null if unsupported; install warns and skips.
   */
  artifactName: () => string | null;
  /** Binary name on disk under binDir. For tarball artifacts, also the entry name inside the archive. */
  binName: string;
  /** Install destination dir. Created if missing. */
  binDir: string;
  /**
   * Artifact shape:
   * - "tarball" (default): release asset is a .tar.gz; we extract `binName` from it.
   * - "binary": release asset IS the binary; we download + chmod it directly.
   */
  artifactKind?: "tarball" | "binary";
  /**
   * Integrity check:
   * - "sha256-sidecar" (default): expects `${artifactUrl}.sha256` next to the artifact.
   * - "version-check": runs `${binName} --version` on the staged binary and matches against `version`.
   *   Use when upstream doesn't publish checksums.
   */
  verify?: "sha256-sidecar" | "version-check";
  /**
   * Optional post-install hook — receives the installed binary path. Errors
   * are logged but do not throw; the binary is already in place.
   */
  postInstall?: (binPath: string) => Promise<void>;
};

/**
 * Best-effort install of a CLI binary from a GitHub release.
 *
 * Stages the download/extract, atomically renames into place. Skips if a binary
 * at `${binDir}/${binName}` already reports the requested version via `--version`.
 * Failures are swallowed and logged — onboarding must succeed offline. The caller's
 * tool surfaces "binary not installed" later.
 *
 * NOTE on sha256-sidecar: tarball and its `.sha256` share the same origin, so the
 * checksum only guards against download corruption — not a compromised upstream
 * release.
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
  if ((await getInstalledVersion(binPath)) === opts.version) return;

  const artifact = opts.artifactName();
  if (!artifact) {
    console.warn(
      `[install] ${opts.binName}: unsupported platform/arch ${process.platform}/${process.arch}`,
    );
    return;
  }

  const artifactKind = opts.artifactKind ?? "tarball";
  const verify = opts.verify ?? "sha256-sidecar";
  const tag = `${opts.tagPrefix ?? "v"}${opts.version}`;
  const artifactUrl = `https://github.com/${opts.owner}/${opts.repo}/releases/download/${tag}/${artifact}`;
  const stagingDir = path.join(opts.binDir, `.${opts.binName}-staging-${process.pid}`);
  const stagedArtifactPath = path.join(stagingDir, artifact);
  // For "binary" artifacts, the downloaded file IS the binary; for "tarball",
  // the binary lands at stagingDir/<binName> after extraction.
  const stagedBinPath =
    artifactKind === "tarball" ? path.join(stagingDir, opts.binName) : stagedArtifactPath;

  fs.mkdirSync(opts.binDir, { recursive: true });
  fs.mkdirSync(stagingDir, { recursive: true });
  console.log(`[install] downloading ${opts.binName} from ${artifactUrl}`);

  try {
    if (verify === "sha256-sidecar") {
      await downloadAndVerify(artifactUrl, stagedArtifactPath);
    } else {
      await downloadFile(artifactUrl, stagedArtifactPath);
    }

    if (artifactKind === "tarball") {
      await extractFromTarball(stagedArtifactPath, stagingDir, opts.binName);
    }

    fs.chmodSync(stagedBinPath, 0o755);

    if (verify === "version-check") {
      const reported = await getInstalledVersion(stagedBinPath);
      if (reported !== opts.version) {
        throw new Error(
          `version check failed: expected ${opts.version}, got ${reported ?? "unknown"}`,
        );
      }
    }

    // renameSync is atomic on the same filesystem — the old binary is never
    // partially overwritten.
    fs.renameSync(stagedBinPath, binPath);
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

async function downloadFile(url: string, dest: string): Promise<void> {
  const resp = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(60_000) });
  if (!resp.ok || !resp.body) {
    throw new Error(`fetch failed: ${resp.status} ${resp.statusText}`);
  }
  await pipeline(resp.body, fs.createWriteStream(dest));
}

async function downloadAndVerify(artifactUrl: string, dest: string): Promise<void> {
  const shaUrl = `${artifactUrl}.sha256`;
  const [tarResp, shaResp] = await Promise.all([
    fetch(artifactUrl, { redirect: "follow", signal: AbortSignal.timeout(60_000) }),
    fetch(shaUrl, { redirect: "follow", signal: AbortSignal.timeout(60_000) }),
  ]);
  if (!tarResp.ok || !tarResp.body) {
    throw new Error(`artifact fetch failed: ${tarResp.status} ${tarResp.statusText}`);
  }
  if (!shaResp.ok) {
    throw new Error(`checksum fetch failed: ${shaResp.status} ${shaResp.statusText}`);
  }

  const shaText = await shaResp.text();
  const expectedSha = shaText.trim().split(/\s+/)[0]?.toLowerCase();
  if (!expectedSha || !/^[0-9a-f]{64}$/.test(expectedSha)) {
    throw new Error(`invalid checksum format: ${shaText.slice(0, 80)}`);
  }

  const hash = createHash("sha256");
  await pipeline(
    tarResp.body,
    async function* (source) {
      for await (const chunk of source) {
        hash.update(chunk as Uint8Array);
        yield chunk;
      }
    },
    fs.createWriteStream(dest),
  );

  const actualSha = hash.digest("hex");
  if (actualSha !== expectedSha) {
    throw new Error(`checksum mismatch: expected ${expectedSha}, got ${actualSha}`);
  }
}

function extractFromTarball(tarballPath: string, outDir: string, entryName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("tar", ["xzf", tarballPath, "-C", outDir, entryName], { timeout: 30_000 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
