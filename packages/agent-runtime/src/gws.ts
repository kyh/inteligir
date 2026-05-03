import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const GWS_CONFIG_DIR = path.join(os.homedir(), ".config", "gws");

export type GwsBootstrapOptions = {
  /** gws release version to install (e.g. "0.22.5"). */
  version: string;
  /** Directory the binary lives in — added to PATH by the caller. */
  binDir: string;
};

/**
 * Best-effort install of the gws CLI and seed an OAuth client_secret if the
 * user doesn't already have one.
 *
 * Failures are swallowed and logged; gws is optional, so onboarding must
 * still succeed when the network is unavailable. If install fails, the
 * agent's bash tool will surface "gws: command not found" later.
 *
 * macOS-only today — Inteligir is a macOS desktop app.
 */
export async function installGws(opts: GwsBootstrapOptions): Promise<void> {
  try {
    await installGwsBinary(opts);
  } catch (err) {
    console.error("[gws] install failed (continuing without gws):", err);
  }
}

/**
 * Map (process.platform, process.arch) to the gws release artifact name.
 * Returns null for unsupported platform/arch combinations.
 */
function gwsArchSuffix(): string | null {
  if (process.platform !== "darwin") return null;
  switch (process.arch) {
    case "arm64":
      return "aarch64-apple-darwin";
    case "x64":
      return "x86_64-apple-darwin";
    default:
      return null;
  }
}

/**
 * Query `gws --version` and return the version string, or null if the
 * binary is missing or doesn't report a parseable version.
 */
async function getInstalledGwsVersion(gwsPath: string): Promise<string | null> {
  if (!fs.existsSync(gwsPath)) return null;
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(gwsPath, ["--version"], { timeout: 5_000 }, (err, out) => {
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

async function installGwsBinary(opts: GwsBootstrapOptions): Promise<void> {
  const gwsPath = path.join(opts.binDir, "gws");

  const installedVersion = await getInstalledGwsVersion(gwsPath);
  if (installedVersion === opts.version) return;

  const arch = gwsArchSuffix();
  if (!arch) {
    console.warn(`[gws] unsupported platform/arch: ${process.platform}/${process.arch}`);
    return;
  }

  const tarball = `google-workspace-cli-${arch}.tar.gz`;
  // NOTE: tarball and its .sha256 share the same origin, so the checksum
  // only guards against download corruption — not a compromised release.
  const baseUrl = `https://github.com/googleworkspace/cli/releases/download/v${opts.version}`;
  const tarballUrl = `${baseUrl}/${tarball}`;
  const shaUrl = `${tarballUrl}.sha256`;
  const tarGzPath = path.join(opts.binDir, tarball);
  // Stage the extraction so a mid-extract failure can't corrupt the
  // currently-installed binary — we atomically rename on success.
  const stagingDir = path.join(opts.binDir, `.gws-staging-${process.pid}`);
  const stagedGwsPath = path.join(stagingDir, "gws");

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
    console.log(`[gws] downloading binary from ${tarballUrl}`);

    const [tarResp, shaResp] = await Promise.all([
      fetch(tarballUrl, {
        redirect: "follow",
        signal: AbortSignal.timeout(60_000),
      }),
      fetch(shaUrl, {
        redirect: "follow",
        signal: AbortSignal.timeout(60_000),
      }),
    ]);
    if (!tarResp.ok || !tarResp.body) {
      throw new Error(`tarball fetch failed: ${tarResp.status} ${tarResp.statusText}`);
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
    await new Promise<void>((resolve, reject) => {
      execFile("tar", ["xzf", tarGzPath, "-C", stagingDir, "gws"], { timeout: 30_000 }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // fs.renameSync is atomic on the same filesystem, so the old binary is
    // never partially overwritten.
    fs.chmodSync(stagedGwsPath, 0o755);
    fs.renameSync(stagedGwsPath, gwsPath);
    cleanup();
    console.log(`[gws] installed binary to ${gwsPath}`);
  } catch (err) {
    console.error("[gws] binary install failed:", err);
    cleanup();
    throw err;
  }
}

/**
 * Copy a bundled `client_secret.json` into `~/.config/gws/` if not already
 * present. Required for gws OAuth. Never overwrites — the user may have
 * replaced it with their own GCP credentials.
 *
 * Exported so callers can run it independent of the network-dependent
 * binary/skills install — if the user is offline at first launch, the
 * client_secret should still land on disk so OAuth works once gws is
 * installed later.
 */
export function seedGwsClientSecret(bundledResourcesDir: string): void {
  const secretSrc = path.join(bundledResourcesDir, "client_secret.json");
  const secretDest = path.join(GWS_CONFIG_DIR, "client_secret.json");

  if (!fs.existsSync(secretSrc)) {
    console.warn("[gws] client_secret.json not found in bundled resources — OAuth will not work");
    return;
  }

  fs.mkdirSync(GWS_CONFIG_DIR, { recursive: true });
  // COPYFILE_EXCL makes the copy fail with EEXIST if the destination already
  // exists — atomic equivalent of "never overwrite". Avoids the TOCTOU window
  // an existsSync()-then-copy pair leaves open.
  try {
    fs.copyFileSync(secretSrc, secretDest, fs.constants.COPYFILE_EXCL);
    console.log(`[gws] seeded client_secret.json → ${secretDest}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return;
    throw err;
  }
}
