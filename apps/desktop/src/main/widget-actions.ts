import { shell } from "electron";
import { z } from "zod";

import { completeOnce } from "@/agent/setup";
import { getAgent } from "@/main/app-machine";
import { execute } from "@/main/executor/executor-client";
import { createIpcHandler } from "@/main/lib/ipc-handler";
import { IPC_CHANNELS, isHttpUrl } from "@/shared/ipc";

const FETCH_TIMEOUT_MS = 30_000;
const FETCH_TEXT_CAP = 100_000;
const FETCH_MAX_REDIRECTS = 5;

type FetchHttpTextDeps = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  textCap?: number;
  maxRedirects?: number;
};

type OpenExternal = (url: string) => Promise<unknown>;

export function registerWidgetActionIpcHandlers(): void {
  createIpcHandler(
    IPC_CHANNELS.WIDGET_SEND_PROMPT,
    z.object({ prompt: z.string().min(1) }),
    async ({ prompt }) => {
      const agent = getAgent();
      if (!agent) throw new Error("Agent unavailable");
      // Await so an agent-side error rejects the IPC and the renderer's
      // sendPrompt catch can surface a toast — `void`'ing the promise made
      // the invoke resolve immediately and swallowed failures.
      await agent.sendMessage(prompt);
    },
  );

  createIpcHandler(
    IPC_CHANNELS.WIDGET_COMPLETE,
    z.object({
      prompt: z.string().min(1),
      system: z.string().optional(),
    }),
    ({ prompt, system }) => completeOnce(prompt, system),
  );

  createIpcHandler(IPC_CHANNELS.WIDGET_FETCH, z.object({ url: z.string() }), ({ url }) =>
    fetchHttpText(url),
  );

  createIpcHandler(
    IPC_CHANNELS.WIDGET_CALL_TOOL,
    z.object({ tool: z.string().min(1), input: z.unknown().optional() }),
    ({ tool, input }) => widgetCallTool(tool, input),
  );

  createIpcHandler(IPC_CHANNELS.WIDGET_OPEN_URL, z.object({ url: z.string() }), ({ url }) =>
    openHttpUrl(url),
  );
}

// A dotted accessor into executor's `tools.*` proxy: a namespace and at least
// one tool segment (e.g. `github.search_issues`). We interpolate this into the
// code-mode snippet, so it must be a strict identifier path — never anything
// that could break out of the member-access expression. Real tool paths never
// use JS meta names, and `tools.x.constructor`/`__proto__`/`prototype` would
// reach the runtime's own machinery rather than a tool, so reject them.
const TOOL_PATH_RE = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/;
const UNSAFE_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

/**
 * Invoke a configured integration tool from a widget via executor's code-mode
 * sandbox, returning just the tool's data. Unlike the agent's `execute` tool —
 * which lets the model write arbitrary TypeScript — this is a fixed snippet:
 * one namespaced `tools.*` call with a JSON input, with the standard
 * `{ ok, data | error }` envelope unwrapped. Throws on a bad tool path, a
 * failed call, or an execution that pauses for interaction (widgets can't
 * resume an elicitation).
 */
export async function widgetCallTool(tool: string, input: unknown): Promise<unknown> {
  if (
    !TOOL_PATH_RE.test(tool) ||
    tool.split(".").some((segment) => UNSAFE_PATH_SEGMENTS.has(segment))
  ) {
    throw new Error(`Invalid tool path '${tool}' (expected e.g. 'namespace.tool')`);
  }
  // Pass input as a JSON string parsed inside the sandbox, not as a JS object
  // literal: a literal reinterprets a "__proto__" key as a prototype setter
  // (Annex B.3.1), corrupting the tool's input. JSON.parse keeps JSON semantics
  // and a string literal can't break out of the expression.
  const code = [
    `const __input = JSON.parse(${JSON.stringify(JSON.stringify(input ?? {}))});`,
    `const __r = await tools.${tool}(__input);`,
    `if (!__r || __r.ok !== true) {`,
    `  throw new Error(typeof __r?.error === "string" ? __r.error : "Tool call failed");`,
    `}`,
    `return __r.data;`,
  ].join("\n");
  const result = await execute(code);
  if (result.status === "paused") {
    throw new Error("Tool call requires interaction and cannot run from a widget");
  }
  if (result.isError) {
    throw new Error(result.text || "Tool call failed");
  }
  return result.structured;
}

export async function fetchHttpText(url: string, deps: FetchHttpTextDeps = {}): Promise<string> {
  // Main-process fetch bypasses renderer CSP/CORS. Keep the trusted widget API
  // web-only and validate every redirect hop, not just the initial URL.
  const fetchImpl = deps.fetchImpl ?? fetch;
  const maxRedirects = deps.maxRedirects ?? FETCH_MAX_REDIRECTS;
  const signal = AbortSignal.timeout(deps.timeoutMs ?? FETCH_TIMEOUT_MS);
  let currentUrl = url;
  let response: Response | null = null;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!isHttpUrl(currentUrl)) throw new Error("Only http(s) URLs can be fetched");
    const next = await fetchImpl(currentUrl, { redirect: "manual", signal });
    if (next.status >= 300 && next.status < 400) {
      const location = next.headers.get("location");
      if (!location) throw new Error("Redirect with no Location header");
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    response = next;
    break;
  }
  if (!response) throw new Error(`Too many redirects (>${maxRedirects})`);
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  return readCappedText(response, deps.textCap ?? FETCH_TEXT_CAP);
}

async function readCappedText(response: Response, textCap: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  try {
    while (out.length < textCap) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
    }
    out += decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return out.length > textCap ? out.slice(0, textCap) : out;
}

export async function openHttpUrl(
  url: string,
  openExternal: OpenExternal = (target) => shell.openExternal(target),
): Promise<boolean> {
  if (!isHttpUrl(url)) return false;
  await openExternal(url);
  return true;
}
