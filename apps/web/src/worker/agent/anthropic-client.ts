// The built-in agent's Messages client, from this deployment's bindings alone. Claude is reached
// through the target's AI Gateway on its provider-native Anthropic route
// (developers.cloudflare.com/ai-gateway/usage/providers/anthropic/), which holds the target's
// Anthropic key itself (BYOK, provider credentials required), so the Worker sends no key: the
// SDK's own `x-api-key` and `Authorization` are left off and the gateway's token rides
// `cf-aig-authorization`, and every request asks the gateway to keep no prompt or reply, only its
// metadata. The SDK retries nothing, since a thread sends a cut or failed call again itself, whole
// (`./thread-loop`). With no gateway the client is null: every send answers that the agent cannot
// be reached, and nothing is faked. The local Worker and the e2e scenarios name instead the
// scripted Messages API on this machine (tools/messages-fake) by `ANTHROPIC_FAKE_URL`, which only
// `vite dev` and the e2e harness declare and which names a loopback address alone, so a deployed
// Worker never reaches a fake. The client is built with every value given, never the SDK's
// defaults, which read `process.env`.

import Anthropic, { APIError } from "@anthropic-ai/sdk";
import type { ClientOptions } from "@anthropic-ai/sdk";
import { z } from "zod";

import { errorFields } from "../log";

// the SDK's own ceiling on the wait for a reply's headers, written out; the thread's watchdog cuts
// a reply silent for three minutes first, headers or not (`./thread-loop`)
const CALL_TIMEOUT_MS = 10 * 60_000;

// the fake answers on this machine alone
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

const fakeUrlSchema = z
  .url({ protocol: /^http$/u })
  .refine((url) => LOOPBACK_HOSTS.has(new URL(url).hostname), {
    error: "ANTHROPIC_FAKE_URL names this machine alone",
  });

const gatewaySchema = z.object({
  AGENT_GATEWAY_URL: z.url({ protocol: /^https$/u }),
  AI_GATEWAY_TOKEN: z.string().min(1),
});

// the fake's token: it refuses a request without the header, as the gateway does
const FAKE_GATEWAY_TOKEN = "messages-fake";

const presentText = (value: string | undefined): string | null =>
  value === undefined || value === "" ? null : value;

// where the client sends, and the gateway token it sends there, or null with no gateway
const routeOf = (env: Env): { readonly baseURL: string; readonly token: string } | null => {
  const fake = presentText(env.ANTHROPIC_FAKE_URL);
  if (fake !== null) {
    return { baseURL: fakeUrlSchema.parse(fake), token: FAKE_GATEWAY_TOKEN };
  }
  const gateway = gatewaySchema.safeParse({
    AGENT_GATEWAY_URL: presentText(env.AGENT_GATEWAY_URL) ?? undefined,
    AI_GATEWAY_TOKEN: presentText(env.AI_GATEWAY_TOKEN) ?? undefined,
  });
  return gateway.success
    ? { baseURL: gateway.data.AGENT_GATEWAY_URL, token: gateway.data.AI_GATEWAY_TOKEN }
    : null;
};

// whether this deployment has a Claude to call: the predicate the client is built by, which the
// cell asks before it lets a send in
export const agentConfigured = (env: Env): boolean => routeOf(env) !== null;

// `fetch` is the thread's listening one over the platform's (`./thread-loop`), or a suite's own
export const anthropicClient = (env: Env, fetch?: ClientOptions["fetch"]): Anthropic | null => {
  const route = routeOf(env);
  if (route === null) {
    return null;
  }
  return new Anthropic({
    apiKey: null,
    authToken: null,
    baseURL: route.baseURL,
    defaultHeaders: {
      Authorization: null,
      "cf-aig-authorization": `Bearer ${route.token}`,
      "cf-aig-collect-log-payload": "false",
    },
    fetch,
    maxRetries: 0,
    timeout: CALL_TIMEOUT_MS,
  });
};

// what a failed call logs: the SDK's error carries the status and the request id Anthropic's
// support reads (platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript#handling-errors)
export const callFailureFields = (cause: unknown) => ({
  ...errorFields(cause),
  requestId: cause instanceof APIError ? (cause.requestID ?? null) : null,
  status: cause instanceof APIError ? (cause.status ?? null) : null,
});
