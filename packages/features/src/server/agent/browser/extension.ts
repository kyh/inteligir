/**
 * Browser extension — thin proxy to the bundled `agent-browser` CLI.
 *
 * setup() installs the agent-browser binary from its GitHub release and
 * runs `agent-browser install` once to provision the browser runtime.
 * register() shells out to the binary on each tool invocation; agent-browser
 * owns lifecycle, navigation waits, element refs, screenshots, tabs, and
 * its daemon session. Inteligir only owns the tool affordance and result
 * shaping (specifically: surfacing screenshots as image content).
 *
 * Bundle is non-critical — a failed install logs and continues. The tool
 * itself reports "agent-browser binary not installed" on first invocation
 * if the binary is missing.
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { Type, type Static } from "@sinclair/typebox";
import { toErrorMessage } from "@repo/features/ipc";
import { installCliFromGithubRelease } from "@repo/features/server/agent-runtime/install";
import { runCli } from "@repo/features/server/agent-runtime/run-cli";

import { inteligirPath } from "../paths";
import type { PiExtensionBundle } from "../extension";
import { formatCliOutput, textResult } from "../extension-helpers";
import type { SetupProgress } from "@repo/features/ipc";

const AGENT_BROWSER_VERSION = "0.26.0";

// SHA-256 of every release artifact, pinned at the time of the
// AGENT_BROWSER_VERSION bump above. Verified at install time. Recompute via
// `curl -L <url> | shasum -a 256` for each platform when bumping.
const AGENT_BROWSER_SHA256: Record<string, string> = {
  "agent-browser-darwin-arm64": "18f7af7c57ab522bd80f64112b8d7ff43e63a98d98064ba13a96363aa9ae2650",
  "agent-browser-darwin-x64": "f5198f4485430ff425f7682db405eca66b80ad82d501d04d6d409574dd4283db",
  "agent-browser-linux-arm64": "b3901b17298f6ce6511fcae5c576068a3e8a510ecb365c8ccd876b9b82db4447",
  "agent-browser-linux-x64": "8784dc259abf72ee04e751b45677d956387af50c99aec5dcd7a41a9bc498e3c3",
  "agent-browser-win32-x64.exe": "540fc7d8b3ec8dea2f84df605492d5ca0e1921281adf8543dc0326109c851b2a",
};
const BROWSER_TIMEOUT_MS = 120_000;
const BROWSER_MAX_BUFFER = 20 * 1024 * 1024;
const BROWSER_SESSION = "inteligir";
const SCREENSHOT_DIR = inteligirPath("screenshots");

const binaryName = process.platform === "win32" ? "agent-browser.exe" : "agent-browser";

type BrowserTextContent = { type: "text"; text: string };
type BrowserImageContent = { type: "image"; data: string; mimeType: string };
type BrowserToolResult = {
  content: (BrowserTextContent | BrowserImageContent)[];
  details: Record<string, unknown>;
};

const BrowserRunSchema = Type.Object({
  args: Type.Array(Type.String(), {
    description:
      "Arguments to pass to agent-browser, e.g. ['open', 'amazon.com'], ['snapshot', '-i'], ['click', '@e2'], ['screenshot', '--full']. Run ['--help'] to discover commands.",
  }),
  stdin: Type.Optional(Type.String({ description: "Optional stdin to pipe to agent-browser." })),
});

const browserExtension: PiExtensionBundle = {
  name: "browser",
  cli: {
    name: "agent-browser",
    version: AGENT_BROWSER_VERSION,
    binPath: inteligirPath("bin", binaryName),
  },
  setup: async ({ binDir, onProgress, force }) => {
    onProgress({ step: "Downloading browser CLI", percent: null });
    await installCliFromGithubRelease({
      owner: "vercel-labs",
      repo: "agent-browser",
      version: AGENT_BROWSER_VERSION,
      binName: binaryName,
      binDir,
      artifactKind: "binary",
      verify: "inline-sha256",
      sha256: AGENT_BROWSER_SHA256,
      artifactName: agentBrowserAssetName,
      postInstall: (binPath) => installBrowserRuntime(binPath, onProgress),
      force,
    });
  },
  register: ({ binDir }) => {
    const browserPath = path.join(binDir, binaryName);

    return (pi) => {
      pi.registerTool({
        name: "browser",
        label: "browser",
        description:
          "Browser automation CLI powered by agent-browser. " +
          "Use args exactly as CLI args after `agent-browser`: ['open', 'amazon.com'], ['snapshot', '-i'], ['click', '@e2'], ['fill', '@e3', 'text'], ['screenshot', '--full']. " +
          "One shared headed session is used for all calls.",
        parameters: BrowserRunSchema,
        execute: async (_toolCallId, params: Static<typeof BrowserRunSchema>) => {
          try {
            const result = await runCli(browserPath, params.args, {
              timeoutMs: BROWSER_TIMEOUT_MS,
              maxBuffer: BROWSER_MAX_BUFFER,
              stdin: params.stdin,
              env: {
                ...process.env,
                AGENT_BROWSER_JSON: "true",
                AGENT_BROWSER_HEADED: "true",
                AGENT_BROWSER_SESSION: BROWSER_SESSION,
                AGENT_BROWSER_SCREENSHOT_DIR: SCREENSHOT_DIR,
              },
              notFoundMessage: "agent-browser binary not installed",
            });
            return await toToolResult(params.args, result);
          } catch (err) {
            return textResult(`browser error: ${toErrorMessage(err)}`);
          }
        },
      });
    };
  },
};

export default browserExtension;

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

// agent-browser's install command emits progress like:
//   "  8/169 MB (5%)"
//   "Downloading Chrome 148.0.7778.167 for mac-arm64"
// We forward the percentage to onProgress so the onboarding bar can fill.
const PERCENT_LINE = /(\d{1,3})\s*%/;
const STEP_PREFIXES = ["Downloading", "Installing", "Extracting"];

function parseStep(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  for (const prefix of STEP_PREFIXES) {
    if (trimmed.startsWith(prefix)) return trimmed;
  }
  return null;
}

function installBrowserRuntime(
  binPath: string,
  onProgress: (p: SetupProgress) => void,
): Promise<void> {
  // agent-browser ships its own runtime install command — needs to run once
  // post-binary-install to provision the browser engine. Up to 5 minutes;
  // log-and-continue on failure since the binary is already in place.
  return new Promise<void>((resolve, reject) => {
    let buffered = "";
    let lastStep = "Installing browser runtime";

    const handle = (chunk: string | Buffer): void => {
      // agent-browser emits progress lines without trailing \n (carriage-return
      // updates in place), so split on \r and \n both. Last fragment is held.
      buffered += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      const parts = buffered.split(/[\r\n]+/);
      buffered = parts.pop() ?? "";
      for (const part of parts) {
        const step = parseStep(part);
        if (step) lastStep = step;
        const match = part.match(PERCENT_LINE);
        const percent = match ? Math.min(100, Math.max(0, Number(match[1]))) : null;
        if (step || match) onProgress({ step: lastStep, percent });
      }
    };

    const child = execFile(binPath, ["install"], { timeout: 300_000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`browser runtime install failed: ${String(stdout)}${String(stderr)}`));
        return;
      }
      resolve();
    });
    child.stdout?.on("data", handle);
    child.stderr?.on("data", handle);
  });
}

async function toToolResult(
  args: string[],
  result: { stdout: string; stderr: string; code: number },
): Promise<BrowserToolResult> {
  const textContent: BrowserTextContent = {
    type: "text",
    text: formatCliOutput(result),
  };
  const content: (BrowserTextContent | BrowserImageContent)[] = [textContent];

  const screenshotPath = screenshotResultPath(args, result.stdout);
  if (screenshotPath) {
    try {
      const image = await fs.readFile(screenshotPath, { encoding: "base64" });
      content.push({
        type: "image",
        data: image,
        mimeType: mimeTypeForPath(screenshotPath),
      });
    } catch (err) {
      textContent.text = `${textContent.text}\n\n[screenshot read failed]\n${toErrorMessage(err)}`;
    }
  }

  return { content, details: {} };
}

function screenshotResultPath(args: string[], stdout: string): string | null {
  if (!args.includes("screenshot")) return null;
  const parsed = parseJson(stdout);
  const data = objectProperty(parsed, "data");
  return stringProperty(data, "path");
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function objectProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return Object.entries(value).find(([entryKey]) => entryKey === key)?.[1];
}

function stringProperty(value: unknown, key: string): string | null {
  const property = objectProperty(value, key);
  return typeof property === "string" ? property : null;
}

function mimeTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}
