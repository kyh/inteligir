import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";

export type PeekabooBootstrapOptions = {
  /** peekaboo release version to install (e.g. "3.0.0"). */
  version: string;
  /** Directory the binary lives in — added to PATH by the caller. */
  binDir: string;
};

/**
 * Best-effort install of the peekaboo CLI.
 *
 * Failures are swallowed and logged; peekaboo is optional, so onboarding must
 * still succeed when the network is unavailable. If install fails, the
 * peekaboo extension surfaces a clear error when the agent tries to use it.
 *
 * macOS-only (Sequoia 15+) — Inteligir is a macOS desktop app and peekaboo
 * itself only runs on macOS 15.
 */
export async function installPeekaboo(opts: PeekabooBootstrapOptions): Promise<void> {
  try {
    await installPeekabooBinary(opts);
  } catch (err) {
    console.error("[peekaboo] install failed (continuing without peekaboo):", err);
  }
}

async function getInstalledPeekabooVersion(peekabooPath: string): Promise<string | null> {
  if (!fs.existsSync(peekabooPath)) return null;
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(peekabooPath, ["--version"], { timeout: 5_000 }, (err, out) => {
        if (err) reject(err);
        else resolve(out);
      });
    });
    const match = stdout.match(/\d+\.\d+\.\d+/);
    return match?.[0] ?? null;
  } catch {
    return null;
  }
}

async function installPeekabooBinary(opts: PeekabooBootstrapOptions): Promise<void> {
  if (process.platform !== "darwin") {
    console.warn(`[peekaboo] unsupported platform: ${process.platform} (macOS only)`);
    return;
  }

  const peekabooPath = path.join(opts.binDir, "peekaboo");

  const installedVersion = await getInstalledPeekabooVersion(peekabooPath);
  if (installedVersion === opts.version) return;

  // Single universal binary (arm64 + x86_64) — no per-arch suffix.
  const tarball = "peekaboo-macos-universal.tar.gz";
  // Tarball and its checksum share the same origin, so the hash check only
  // guards against download corruption — not a compromised release.
  const baseUrl = `https://github.com/openclaw/Peekaboo/releases/download/v${opts.version}`;
  const tarballUrl = `${baseUrl}/${tarball}`;
  const checksumsUrl = `${baseUrl}/checksums.txt`;
  const tarGzPath = path.join(opts.binDir, tarball);
  // Stage the extraction so a mid-extract failure can't corrupt the
  // currently-installed binary — we atomically rename on success.
  const stagingDir = path.join(opts.binDir, `.peekaboo-staging-${process.pid}`);
  // Tarball nests the binary under `peekaboo-macos-universal/peekaboo`.
  const stagedPeekabooPath = path.join(stagingDir, "peekaboo-macos-universal", "peekaboo");

  const cleanup = () => {
    try {
      fs.unlinkSync(tarGzPath);
    } catch {
      /* ignore */
    }
    try {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  };

  try {
    fs.mkdirSync(opts.binDir, { recursive: true });
    console.log(`[peekaboo] downloading binary from ${tarballUrl}`);

    const [tarResp, checksumsResp] = await Promise.all([
      fetch(tarballUrl, {
        redirect: "follow",
        signal: AbortSignal.timeout(60_000),
      }),
      fetch(checksumsUrl, {
        redirect: "follow",
        signal: AbortSignal.timeout(60_000),
      }),
    ]);
    if (!tarResp.ok || !tarResp.body) {
      throw new Error(`tarball fetch failed: ${tarResp.status} ${tarResp.statusText}`);
    }
    if (!checksumsResp.ok) {
      throw new Error(`checksums fetch failed: ${checksumsResp.status} ${checksumsResp.statusText}`);
    }

    // checksums.txt is an aggregate file: each line is `<hex>  <filename>`.
    // Find the line for our tarball — there's only one universal asset, but
    // future-proof by matching on filename rather than line position.
    const checksumsText = await checksumsResp.text();
    const expectedSha = checksumsText
      .split("\n")
      .map((line) => line.trim().split(/\s+/))
      .find(([, name]) => name === tarball)?.[0]
      ?.toLowerCase();
    if (!expectedSha || !/^[0-9a-f]{64}$/.test(expectedSha)) {
      throw new Error(`checksum for ${tarball} not found in checksums.txt`);
    }

    const hash = createHash("sha256");
    const dest = fs.createWriteStream(tarGzPath);
    await pipeline(
      tarResp.body,
      async function* (source) {
        for await (const chunk of source) {
          hash.update(chunk as Uint8Array);
          yield chunk;
        }
      },
      dest,
    );

    const actualSha = hash.digest("hex");
    if (actualSha !== expectedSha) {
      throw new Error(`checksum mismatch: expected ${expectedSha}, got ${actualSha}`);
    }

    fs.mkdirSync(stagingDir, { recursive: true });
    // Tarball nests the binary one level deep — extract just that path.
    await new Promise<void>((resolve, reject) => {
      execFile(
        "tar",
        ["xzf", tarGzPath, "-C", stagingDir, "peekaboo-macos-universal/peekaboo"],
        { timeout: 30_000 },
        (err) => {
          if (err) reject(err);
          else resolve();
        },
      );
    });

    // fs.renameSync is atomic on the same filesystem, so the old binary is
    // never partially overwritten.
    fs.chmodSync(stagedPeekabooPath, 0o755);
    fs.renameSync(stagedPeekabooPath, peekabooPath);
    cleanup();
    console.log(`[peekaboo] installed binary to ${peekabooPath}`);
  } catch (err) {
    console.error("[peekaboo] binary install failed:", err);
    cleanup();
    throw err;
  }
}
