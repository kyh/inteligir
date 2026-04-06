/**
 * Minimal CDP WebSocket client + Chrome discovery/launch.
 *
 * Connects to Chrome via the DevTools Protocol over WebSocket.
 * No Puppeteer/Playwright dependency — just native Node.js WebSocket.
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CDPEventHandler = (params: Record<string, unknown>) => void;

type PendingRequest = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

// ---------------------------------------------------------------------------
// CDP WebSocket client
// ---------------------------------------------------------------------------

const REQUEST_TIMEOUT_MS = 30_000;

export class CDPClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private listeners = new Map<string, Set<CDPEventHandler>>();

  private constructor() {}

  static async connect(wsUrl: string): Promise<CDPClient> {
    const client = new CDPClient();
    await client.open(wsUrl);
    return client;
  }

  private open(wsUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", (e) => reject(new Error(`CDP WebSocket error: ${String(e)}`)), { once: true });

      ws.addEventListener("message", (event) => {
        const data = JSON.parse(String(event.data)) as Record<string, unknown>;
        const id = data["id"] as number | undefined;

        if (id !== undefined && this.pending.has(id)) {
          // Response to a command
          const req = this.pending.get(id);
          this.pending.delete(id);
          if (req) {
            clearTimeout(req.timer);
            if (data["error"]) {
              const err = data["error"] as Record<string, unknown>;
              req.reject(new Error(`CDP error: ${String(err["message"])}`));
            } else {
              req.resolve((data["result"] as Record<string, unknown>) ?? {});
            }
          }
        } else if (data["method"]) {
          // CDP event
          const method = data["method"] as string;
          const params = (data["params"] as Record<string, unknown>) ?? {};
          const handlers = this.listeners.get(method);
          if (handlers) {
            for (const handler of handlers) {
              try { handler(params); } catch { /* listener error */ }
            }
          }
        }
      });

      ws.addEventListener("close", () => {
        // Reject all pending requests
        for (const [, req] of this.pending) {
          clearTimeout(req.timer);
          req.reject(new Error("CDP WebSocket closed"));
        }
        this.pending.clear();
        this.ws = null;
      });
    });
  }

  async send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("CDP WebSocket not connected");
    }

    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP request timed out: ${method}`));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });
      this.ws?.send(JSON.stringify({ id, method, params }));
    });
  }

  on(event: string, handler: CDPEventHandler): void {
    let handlers = this.listeners.get(event);
    if (!handlers) {
      handlers = new Set();
      this.listeners.set(event, handlers);
    }
    handlers.add(handler);
  }

  off(event: string, handler: CDPEventHandler): void {
    this.listeners.get(event)?.delete(handler);
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Runtime.evaluate helper — shared by all browser modules
// ---------------------------------------------------------------------------

export async function evaluate(cdp: CDPClient, expression: string): Promise<unknown> {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  const details = result["exceptionDetails"] as Record<string, unknown> | undefined;
  if (details) {
    const text = (details["text"] as string) ?? "Script evaluation failed";
    const exception = details["exception"] as Record<string, unknown> | undefined;
    const desc = exception?.["description"] as string | undefined;
    throw new Error(desc ?? text);
  }
  return (result["result"] as Record<string, unknown>)?.["value"];
}

// ---------------------------------------------------------------------------
// Chrome discovery and launch
// ---------------------------------------------------------------------------

const DEFAULT_CDP_PORT = 9222;

/** Platform-specific Chrome binary paths. */
function chromeCandidates(): string[] {
  switch (process.platform) {
    case "darwin":
      return [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
      ];
    case "linux":
      return [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
      ];
    case "win32":
      return [
        `${process.env["PROGRAMFILES"]}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env["LOCALAPPDATA"]}\\Google\\Chrome\\Application\\chrome.exe`,
      ];
    default:
      return [];
  }
}

function findChromeBinary(): string {
  for (const candidate of chromeCandidates()) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    "Could not find Chrome. Install Google Chrome or set CHROME_CDP_URL environment variable.",
  );
}

let chromeProcess: ChildProcess | null = null;

/**
 * Launch a dedicated Chrome instance with CDP debugging enabled.
 *
 * Uses a separate profile directory (~/.inteligir/chrome-profile) so it never
 * conflicts with the user's running Chrome. This matches the pattern used by
 * agent-browser (Chrome for Testing) and OpenClaw (dedicated Chromium).
 *
 * The user's existing Chrome is NEVER killed or restarted. If the user wants
 * the agent to use their logged-in sessions, they should set CHROME_CDP_URL
 * or launch Chrome themselves with --remote-debugging-port=9222.
 */
export async function launchChrome(port = DEFAULT_CDP_PORT): Promise<void> {
  if (chromeProcess) return;

  const binary = findChromeBinary();
  const profileDir = path.join(os.homedir(), ".inteligir", "chrome-profile");
  fs.mkdirSync(profileDir, { recursive: true });

  console.log(`[browser] launching Chrome: ${binary} (port ${port}, profile: ${profileDir})`);

  chromeProcess = spawn(binary, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ], {
    stdio: "ignore",
    detached: true,
  });

  chromeProcess.unref();
  chromeProcess.on("exit", () => { chromeProcess = null; });

  // Wait for CDP endpoint to become available
  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (resp.ok) return;
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Chrome launched but CDP endpoint not available after ${maxAttempts * 200}ms`);
}

export type TabInfo = {
  id: string;
  webSocketDebuggerUrl: string;
};

/**
 * Discover Chrome's CDP endpoint.
 * Priority: CHROME_CDP_URL env → probe localhost:9222 → launch dedicated Chrome.
 */
export async function discoverChromeEndpoint(port = DEFAULT_CDP_PORT): Promise<string> {
  // 1. Explicit env var (user's own Chrome with debugging, or remote)
  const envUrl = process.env["CHROME_CDP_URL"];
  if (envUrl) return envUrl;

  // 2. Probe default port (user or previous agent Chrome with debugging)
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (resp.ok) return `http://127.0.0.1:${port}`;
  } catch {
    // Not running
  }

  // 3. Launch dedicated Chrome with separate profile
  await launchChrome(port);
  return `http://127.0.0.1:${port}`;
}

/** Open a new tab and return its WebSocket URL. */
export async function openNewTab(
  httpEndpoint: string,
  url = "about:blank",
): Promise<TabInfo> {
  const resp = await fetch(`${httpEndpoint}/json/new?${encodeURIComponent(url)}`);
  if (!resp.ok) throw new Error(`Failed to open new tab: ${resp.status} ${resp.statusText}`);
  const tab = (await resp.json()) as Record<string, string>;
  const wsUrl = tab["webSocketDebuggerUrl"];
  const id = tab["id"];
  if (!wsUrl || !id) throw new Error("Chrome did not return a WebSocket URL for the new tab");
  return { id, webSocketDebuggerUrl: wsUrl };
}

/** Close a tab by target ID. */
export async function closeTab(httpEndpoint: string, targetId: string): Promise<void> {
  await fetch(`${httpEndpoint}/json/close/${targetId}`);
}
