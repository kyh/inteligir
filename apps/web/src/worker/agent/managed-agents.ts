// The cell's Managed Agents client and the agent it runs, from this deployment's bindings alone:
// the API key and the webhooks' signing key are its secrets, and the agent's and environment's
// ids are those `ant apply` recorded in the target's claude-lock.json, which cloudflare.config.ts
// hands over as text, so no id is ever copied by hand. Either missing is no agent: a deployment
// with no key, or whose agent was never applied, has the agent answer that it cannot be reached
// and calls nothing. The client is built with every value given, never the SDK's defaults, which
// read `process.env` and the credential profiles a Worker cannot hold
// (platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript).

import Anthropic from "@anthropic-ai/sdk";
import type { ClientOptions } from "@anthropic-ai/sdk";
import { z } from "zod";

const API_ORIGIN = "https://api.anthropic.com";

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
      webhookKey: data.ANTHROPIC_WEBHOOK_SIGNING_KEY ?? null,
    }),
    environmentId: data.AGENT_ENVIRONMENT_ID,
  };
};
