import { shell } from "electron";
import { z } from "zod";

import { completeOnce } from "@/agent/setup";
import { getAgent } from "@/main/app-machine";
import { createIpcHandler } from "@/main/lib/ipc-handler";
import { IPC_CHANNELS, isHttpUrl } from "@/shared/ipc";

const FETCH_TIMEOUT_MS = 30_000;
const FETCH_TEXT_CAP = 100_000;
const FETCH_MAX_REDIRECTS = 5;

export function registerWidgetActionIpcHandlers(): void {
  createIpcHandler(
    IPC_CHANNELS.WIDGET_SEND_PROMPT,
    z.object({ prompt: z.string().min(1) }),
    ({ prompt }) => {
      const agent = getAgent();
      if (!agent) throw new Error("Agent unavailable");
      void agent.sendMessage(prompt);
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

  createIpcHandler(IPC_CHANNELS.WIDGET_OPEN_URL, z.object({ url: z.string() }), ({ url }) =>
    openHttpUrl(url),
  );
}

async function fetchHttpText(url: string): Promise<string> {
  // Main-process fetch bypasses renderer CSP/CORS. Keep the trusted widget API
  // web-only and validate every redirect hop, not just the initial URL.
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let currentUrl = url;
  let response: Response | null = null;
  for (let hop = 0; hop <= FETCH_MAX_REDIRECTS; hop++) {
    if (!isHttpUrl(currentUrl)) throw new Error("Only http(s) URLs can be fetched");
    const next = await fetch(currentUrl, { redirect: "manual", signal });
    if (next.status >= 300 && next.status < 400) {
      const location = next.headers.get("location");
      if (!location) throw new Error("Redirect with no Location header");
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    response = next;
    break;
  }
  if (!response) throw new Error(`Too many redirects (>${FETCH_MAX_REDIRECTS})`);
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  return readCappedText(response);
}

async function readCappedText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  try {
    while (out.length < FETCH_TEXT_CAP) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
    }
    out += decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return out.length > FETCH_TEXT_CAP ? out.slice(0, FETCH_TEXT_CAP) : out;
}

async function openHttpUrl(url: string): Promise<boolean> {
  if (!isHttpUrl(url)) return false;
  await shell.openExternal(url);
  return true;
}
