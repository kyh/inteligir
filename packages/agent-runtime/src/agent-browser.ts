import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";

export type AgentBrowserBootstrapOptions = {
  /** agent-browser release version to install, without the leading "v". */
  version: string;
  /** Directory the binary lives in. */
  binDir: string;
};

/**
 * Best-effort install of the agent-browser CLI.
 *
 * We fetch the pinned GitHub release binary directly so users do not need
 * Node, npm, Homebrew, or Cargo installed. Then we let agent-browser install
 * its browser runtime. Failures are swallowed; the browser tool will surface a
 * clear "binary not installed" error later.
 */
export async function installAgentBrowser(
  opts: AgentBrowserBootstrapOptions,
): Promise<void> {
  try {
    const agentBrowserPath = await installAgentBrowserBinary(opts);
    if (agentBrowserPath) {
      await installAgentBrowserRuntime(agentBrowserPath);
    }
  } catch (err) {
    console.error(
      "[agent-browser] install failed (continuing without agent-browser):",
      err,
    );
  }
}

function agentBrowserAssetName(): string | null {
  switch (`${process.platform}/${process.arch}`) {
    case "darwin/arm64":
      return "agent-browser-darwin-arm64";
    case "darwin/x64":
      return "agent-browser-darwin-x64";
    case "linux/arm64":
      return "agent-browser-linux-arm64";
    case "linux/x64":
      return "agent-browser-linux-x64";
    case "win32/x64":
      return "agent-browser-win32-x64.exe";
    default:
      return null;
  }
}

async function getInstalledAgentBrowserVersion(
  agentBrowserPath: string,
): Promise<string | null> {
  if (!fs.existsSync(agentBrowserPath)) return null;
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        agentBrowserPath,
        ["--version"],
        { timeout: 5_000 },
        (err, out) => {
          if (err) reject(err);
          else resolve(out);
        },
      );
    });
    const match = stdout.match(/\d+\.\d+\.\d+/);
    return match?.[0] ?? null;
  } catch {
    return null;
  }
}

async function installAgentBrowserBinary(
  opts: AgentBrowserBootstrapOptions,
): Promise<string | null> {
  const binaryName =
    process.platform === "win32" ? "agent-browser.exe" : "agent-browser";
  const agentBrowserPath = path.join(opts.binDir, binaryName);
  const installedVersion =
    await getInstalledAgentBrowserVersion(agentBrowserPath);
  if (installedVersion === opts.version) return agentBrowserPath;

  const asset = agentBrowserAssetName();
  if (!asset) {
    console.warn(
      `[agent-browser] unsupported platform/arch: ${process.platform}/${process.arch}`,
    );
    return null;
  }

  const stagingDir = path.join(
    opts.binDir,
    `.agent-browser-staging-${process.pid}`,
  );
  const stagedBinaryPath = path.join(stagingDir, binaryName);
  const url = `https://github.com/vercel-labs/agent-browser/releases/download/v${opts.version}/${asset}`;

  const cleanup = () => {
    try {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  };

  try {
    fs.mkdirSync(opts.binDir, { recursive: true });
    fs.mkdirSync(stagingDir, { recursive: true });

    console.log(`[agent-browser] downloading binary from ${url}`);
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok || !response.body) {
      throw new Error(
        `binary fetch failed: ${response.status} ${response.statusText}`,
      );
    }

    await pipeline(response.body, fs.createWriteStream(stagedBinaryPath));
    fs.chmodSync(stagedBinaryPath, 0o755);

    const version = await getInstalledAgentBrowserVersion(stagedBinaryPath);
    if (version !== opts.version) {
      throw new Error(
        `version check failed: expected ${opts.version}, got ${version ?? "unknown"}`,
      );
    }

    fs.renameSync(stagedBinaryPath, agentBrowserPath);
    cleanup();

    console.log(`[agent-browser] installed binary to ${agentBrowserPath}`);
    return agentBrowserPath;
  } catch (err) {
    console.error("[agent-browser] binary install failed:", err);
    cleanup();
    throw err;
  }
}

async function installAgentBrowserRuntime(
  agentBrowserPath: string,
): Promise<void> {
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        agentBrowserPath,
        ["install"],
        { timeout: 300_000 },
        (err, stdout, stderr) => {
          if (err) {
            reject(
              new Error(
                `browser runtime install failed: ${String(stdout)}${String(stderr)}`,
              ),
            );
            return;
          }
          resolve();
        },
      );
    });
  } catch (err) {
    console.error("[agent-browser] browser runtime install failed:", err);
  }
}
