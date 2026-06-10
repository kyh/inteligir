import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { shell } from "electron";

import { completeOnce } from "@/agent/auth";
import { getAgent } from "@/main/app-machine";
import { dispatchAgentCommand } from "@/main/dispatch/agent-gateway";
import { execute } from "@/main/executor/executor-client";
import { getExecutorDaemon } from "@/main/executor/executor-daemon";
import { handle } from "@/main/lib/ipc-handler";
import { isHttpUrl } from "@/shared/ipc";

const FETCH_TIMEOUT_MS = 30_000;
const FETCH_TEXT_CAP = 100_000;
const FETCH_MAX_REDIRECTS = 5;

type LookupFn = (hostname: string) => Promise<readonly { address: string }[]>;

const defaultLookup: LookupFn = (hostname) => dnsLookup(hostname, { all: true });

type FetchHttpTextDeps = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  textCap?: number;
  maxRedirects?: number;
  lookup?: LookupFn;
};

type OpenExternal = (url: string) => Promise<unknown>;

export function registerWidgetActionIpcHandlers(): void {
  handle("widgetSendPrompt", async ({ prompt }) => {
    if (!getAgent()) throw new Error("Agent unavailable");
    // Route through the gateway so the prompt queues behind an in-flight
    // exclusive turn (chat relay / scheduled task) instead of merging into it.
    // On the common unlocked path this still awaits sendMessage, so an
    // agent-side error rejects the IPC and the renderer's sendPrompt catch can
    // surface a toast — `void`'ing the promise made the invoke resolve
    // immediately and swallowed failures.
    await dispatchAgentCommand({ type: "user_message", text: prompt });
  });

  handle("widgetComplete", ({ prompt, system }) => completeOnce(prompt, system));
  handle("widgetFetch", ({ url }) => fetchHttpText(url));
  handle("widgetCallTool", async ({ tool, input }) => {
    // Wait for the daemon to finish starting before invoking the tool. Widgets
    // fire onMount within ~100ms of the renderer mounting; the daemon's
    // spawn+ready dance takes 10–20s warm. Without this, every cold-start
    // callTool surfaces as "ExecutorClientError: executor daemon is not
    // running" even though the daemon is on its way. start() is idempotent
    // and returns the cached in-flight promise, so this just awaits the same
    // eager-start kicked off by seedResources.
    await getExecutorDaemon().start();
    // Return a result envelope rather than throwing: a thrown handler reaches
    // the renderer as Electron's "Error invoking remote method '…': <stack>"
    // string, which a widget renders verbatim into its error card (and which
    // Electron also dumps to the main log). An expected failure — e.g. a seed
    // widget calling a Google tool before the source is connected — should be a
    // clean inline message, not a stack trace.
    try {
      return { ok: true, data: await widgetCallTool(tool, input) };
    } catch (err) {
      return { ok: false, error: cleanToolError(err) };
    }
  });
  handle("widgetOpenUrl", ({ url }) => openHttpUrl(url));
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
// Collapse the error into a short message safe to show in a widget. The failure
// is re-wrapped as it bubbles sandbox → executor → client → here, so the raw
// message accumulates leading "Error: " prefixes ("Error: Error: Tool call
// failed"); strip them. Stacks never reach this path — we only read `.message`.
function cleanToolError(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return raw.replace(/^(?:Error:\s*)+/i, "").trim() || "Tool call failed";
}

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

// ---------------------------------------------------------------------------
// SSRF guard for widgetFetch. Main-process fetch runs outside renderer
// CSP/CORS and inside the LAN, so an agent-authored widget spec could
// otherwise read link-local metadata services, the loopback executor daemon,
// or anything on the local network. Every hop (initial URL + each manual
// redirect) must be http(s) AND resolve only to public addresses.
//
// Known residual: the classification resolves the hostname once while the
// actual fetch re-resolves it (Node's global fetch doesn't take a pinned
// address), leaving a DNS-rebinding TOCTOU window. Closing it needs an
// undici Agent with a custom lookup; out of scope here.
// ---------------------------------------------------------------------------

function ipv4Bytes(address: string): [number, number, number, number] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (!match) return null;
  const a = Number(match[1]);
  const b = Number(match[2]);
  const c = Number(match[3]);
  const d = Number(match[4]);
  if (a > 255 || b > 255 || c > 255 || d > 255) return null;
  return [a, b, c, d];
}

function isReservedIpv4(bytes: readonly [number, number, number, number]): boolean {
  const [a, b] = bytes;
  return (
    a === 0 || // 0.0.0.0/8 — "this network" (0.0.0.0 routes to loopback)
    a === 10 || // 10/8 private
    a === 127 || // 127/8 loopback
    (a === 169 && b === 254) || // 169.254/16 link-local (cloud metadata)
    (a === 172 && b >= 16 && b <= 31) || // 172.16/12 private
    (a === 192 && b === 168) // 192.168/16 private
  );
}

/** Parse an IPv6 literal into its eight 16-bit groups (zone id stripped,
 * `::` expanded, trailing embedded IPv4 folded in). Null when malformed. */
function ipv6Groups(address: string): number[] | null {
  const zoneIdx = address.indexOf("%");
  const addr = zoneIdx === -1 ? address : address.slice(0, zoneIdx);
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string, isTail: boolean): number[] | null => {
    if (part === "") return [];
    const groups: number[] = [];
    const segments = part.split(":");
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i] ?? "";
      if (segment.includes(".")) {
        // Embedded IPv4 (e.g. ::ffff:127.0.0.1) — only valid as the last group.
        if (!isTail || i !== segments.length - 1) return null;
        const v4 = ipv4Bytes(segment);
        if (!v4) return null;
        groups.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(segment)) return null;
      groups.push(Number.parseInt(segment, 16));
    }
    return groups;
  };
  const head = parse(halves[0] ?? "", halves.length === 1);
  if (!head) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const tail = parse(halves[1] ?? "", true);
  if (!tail) return null;
  const fill = 8 - head.length - tail.length;
  if (fill < 1) return null; // "::" must compress at least one zero group
  return [...head, ...Array.from({ length: fill }, () => 0), ...tail];
}

function isReservedIpv6(groups: readonly number[]): boolean {
  const g0 = groups[0] ?? 0;
  // :: (unspecified) and ::1 (loopback)
  if (groups.slice(0, 7).every((g) => g === 0)) {
    const last = groups[7] ?? 0;
    if (last === 0 || last === 1) return true;
  }
  // IPv4-mapped ::ffff:a.b.c.d — classify the embedded IPv4.
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const g6 = groups[6] ?? 0;
    const g7 = groups[7] ?? 0;
    return isReservedIpv4([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff]);
  }
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  return false;
}

/** Whether a resolved address sits in a private/reserved range. Anything we
 * cannot positively classify as a public IP is treated as reserved. */
function isReservedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const bytes = ipv4Bytes(address);
    return bytes ? isReservedIpv4(bytes) : true;
  }
  if (family === 6) {
    const groups = ipv6Groups(address);
    return groups ? isReservedIpv6(groups) : true;
  }
  return true;
}

/** Reject non-http(s) URLs and hosts that are (or resolve to) private or
 * reserved addresses. WHATWG URL parsing canonicalizes obfuscated literals
 * (e.g. `http://2130706433` → hostname `127.0.0.1`) before we classify. */
async function assertPublicHttpTarget(url: string, lookupFn: LookupFn): Promise<void> {
  if (!isHttpUrl(url)) throw new Error("Only http(s) URLs can be fetched");
  const { hostname } = new URL(url);
  const bare =
    hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  const addresses =
    isIP(bare) !== 0 ? [bare] : (await lookupFn(bare)).map((entry) => entry.address);
  if (addresses.length === 0) throw new Error(`Could not resolve host '${bare}'`);
  for (const address of addresses) {
    // ANY private record fails the whole host — a half-private DNS answer is
    // exactly what a rebinding attack looks like.
    if (isReservedAddress(address)) {
      throw new Error(`Refusing to fetch private or reserved address (${bare} → ${address})`);
    }
  }
}

export async function fetchHttpText(url: string, deps: FetchHttpTextDeps = {}): Promise<string> {
  // Main-process fetch bypasses renderer CSP/CORS. Keep the trusted widget API
  // web-only and validate every redirect hop, not just the initial URL.
  const fetchImpl = deps.fetchImpl ?? fetch;
  const lookupFn = deps.lookup ?? defaultLookup;
  const maxRedirects = deps.maxRedirects ?? FETCH_MAX_REDIRECTS;
  const signal = AbortSignal.timeout(deps.timeoutMs ?? FETCH_TIMEOUT_MS);
  let currentUrl = url;
  let response: Response | null = null;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicHttpTarget(currentUrl, lookupFn);
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
