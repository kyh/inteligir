// The cell's Managed Agents client and the agent it runs, from this deployment's bindings alone:
// the API key and the webhooks' signing key are its secrets, and the agent's and environment's
// ids are those `ant apply` recorded in the target's claude-lock.json, which cloudflare.config.ts
// hands over as text, so no id is ever copied by hand. Either missing is no agent: a deployment
// with no key, or whose agent was never applied, has the agent answer that it cannot be reached
// and calls nothing. The client is built with every value given, never the SDK's defaults, which
// read `process.env` and the credential profiles a Worker cannot hold
// (platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript). The local Worker and the e2e
// scenarios name instead the fake API `pnpm dev:web` serves on this machine
// (tools/managed-agents-fake), by `MANAGED_AGENTS_FAKE_URL`, which only development mode declares
// and which names a loopback address alone, so a deployed Worker never runs a fake.

import Anthropic, { APIError, NotFoundError } from "@anthropic-ai/sdk";
import type { ClientOptions } from "@anthropic-ai/sdk";
import { z } from "zod";

import { errorFields } from "../log";

const API_ORIGIN = "https://api.anthropic.com";

// the fake's own agent and environment: it has none applied, and runs the definition every session
// of a deployment but production's sends as its overrides (`./session-agent`)
const FAKE_AGENT = { id: "agent_fake", version: 1 } as const;
const FAKE_ENVIRONMENT_ID = "env_fake";

// the fake answers on this machine alone
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

const fakeUrlSchema = z
  .url({ protocol: /^http$/u })
  .refine((url) => LOOPBACK_HOSTS.has(new URL(url).hostname), {
    error: "MANAGED_AGENTS_FAKE_URL names this machine alone",
  });

// a call the cell waits on holds its caller with it, so it is bounded well under the SDK's own ten
// minutes; a stream the cell holds sets its own
const CALL_TIMEOUT_MS = 30_000;

const deploymentSchema = z.object({
  AGENT_ENVIRONMENT_ID: z.string().min(1),
  AGENT_ID: z.string().min(1),
  // ant records an agent's version as text
  AGENT_VERSION: z
    .string()
    .regex(/^[1-9]\d*$/u)
    .transform(Number),
  ANTHROPIC_API_KEY: z.string().min(1),
  // production's alone: a preview registers no webhook and leans on the cell's alarm
  ANTHROPIC_WEBHOOK_SIGNING_KEY: z.string().min(1).optional(),
});

export interface ManagedAgents {
  readonly client: Anthropic;
  // the agent version this deployment's sessions run, pinned so a run is the one applied
  readonly agent: { readonly id: string; readonly version: number };
  readonly environmentId: string;
}

// `fetch` is a suite's recorded Managed Agents API; a deployment passes none and the SDK takes the
// platform's
export const managedAgents = (env: Env, fetch?: ClientOptions["fetch"]): ManagedAgents | null => {
  if (env.MANAGED_AGENTS_FAKE_URL !== undefined && env.MANAGED_AGENTS_FAKE_URL !== "") {
    return {
      agent: FAKE_AGENT,
      client: new Anthropic({
        apiKey: "fake",
        baseURL: fakeUrlSchema.parse(env.MANAGED_AGENTS_FAKE_URL),
        fetch,
        timeout: CALL_TIMEOUT_MS,
        webhookKey: null,
      }),
      environmentId: FAKE_ENVIRONMENT_ID,
    };
  }
  const deployment = deploymentSchema.safeParse(env);
  if (!deployment.success) {
    return null;
  }
  const { data } = deployment;
  return {
    agent: { id: data.AGENT_ID, version: data.AGENT_VERSION },
    client: new Anthropic({
      apiKey: data.ANTHROPIC_API_KEY,
      baseURL: API_ORIGIN,
      fetch,
      timeout: CALL_TIMEOUT_MS,
      webhookKey: data.ANTHROPIC_WEBHOOK_SIGNING_KEY ?? null,
    }),
    environmentId: data.AGENT_ENVIRONMENT_ID,
  };
};

// what a failed call logs: the SDK's error carries the status and the request id Anthropic's
// support reads (platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript#handling-errors)
export const callFailureFields = (cause: unknown) => ({
  ...errorFields(cause),
  requestId: cause instanceof APIError ? (cause.requestID ?? null) : null,
  status: cause instanceof APIError ? (cause.status ?? null) : null,
});

// a call whose effect a resend would double, a create above all, sent once within the client's
// timeout: the SDK would retry one whose answer was lost, and make it twice
export const SEND_ONCE = { maxRetries: 0 } as const;

// a call answered 404: what it would delete is already gone
export const isGone = (cause: unknown): boolean => cause instanceof NotFoundError;
