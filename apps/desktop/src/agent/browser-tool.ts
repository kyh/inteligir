/**
 * Browser tool - thin proxy to the bundled `agent-browser` CLI.
 *
 * `agent-browser` owns browser lifecycle, navigation waits, element refs,
 * screenshots, tabs, and its daemon session. Inteligir only owns the tool
 * affordance and result shaping.
 */

import { execFile, type ExecFileException } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { Type, type Static } from "@sinclair/typebox";
import type { ExtensionAPI } from "@repo/pi-driver";

import { inteligirPath } from "@/main/lib/json-store";

const BROWSER_PATH = path.join(
  inteligirPath("bin"),
  process.platform === "win32" ? "agent-browser.exe" : "agent-browser",
);
const SCREENSHOT_DIR = inteligirPath("screenshots");
const BROWSER_TIMEOUT_MS = 120_000;
const BROWSER_MAX_BUFFER = 20 * 1024 * 1024;
const BROWSER_SESSION = "inteligir";

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
  stdin: Type.Optional(
    Type.String({ description: "Optional stdin to pipe to agent-browser." }),
  ),
});

export function registerBrowserExtension(pi: ExtensionAPI): void {
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
        const result = await runAgentBrowser(params.args, params.stdin);
        return await toToolResult(params.args, result);
      } catch (err) {
        return textResult(
          `browser error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  });
}

function textResult(value: string): BrowserToolResult {
  return { content: [{ type: "text", text: value }], details: {} };
}

function isEnoent(err: ExecFileException | null): boolean {
  return err?.code === "ENOENT";
}

function runAgentBrowser(
  args: string[],
  stdin?: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      BROWSER_PATH,
      args,
      {
        timeout: BROWSER_TIMEOUT_MS,
        maxBuffer: BROWSER_MAX_BUFFER,
        env: {
          ...process.env,
          AGENT_BROWSER_JSON: "true",
          AGENT_BROWSER_HEADED: "true",
          AGENT_BROWSER_SESSION: BROWSER_SESSION,
          AGENT_BROWSER_SCREENSHOT_DIR: SCREENSHOT_DIR,
        },
      },
      (err, stdout, stderr) => {
        if (isEnoent(err)) {
          reject(new Error("agent-browser binary not installed"));
          return;
        }
        const code = err?.code;
        resolve({
          stdout: String(stdout),
          stderr: String(stderr),
          code: typeof code === "number" ? code : err ? 1 : 0,
        });
      },
    );
    if (stdin !== undefined) {
      child.stdin?.end(stdin);
    }
  });
}

async function toToolResult(
  args: string[],
  result: { stdout: string; stderr: string; code: number },
): Promise<BrowserToolResult> {
  const parts: string[] = [];
  if (result.stdout) parts.push(result.stdout);
  if (result.stderr) parts.push(`[stderr]\n${result.stderr}`);
  if (result.code !== 0) parts.push(`[exit ${result.code}]`);

  const textContent: BrowserTextContent = {
    type: "text",
    text: parts.join("\n\n") || "(no output)",
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
      textContent.text = `${textContent.text}\n\n[screenshot read failed]\n${err instanceof Error ? err.message : String(err)}`;
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
