// The fake Managed Agents API (`@repo/managed-agents-fake`), handed to the SDK as its `fetch`, so
// a suite drives the real client with no model and no account
// (platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript#customizing-the-fetch-client):
// its sessions reach the library through this Worker's own connector, in process, with the token
// the account's vault holds, so a turn's writes land in the cell as they would deployed.

import { fakeManagedAgents } from "@repo/managed-agents-fake/fake-api";
import type { FakeManagedAgents } from "@repo/managed-agents-fake/fake-api";
import { env } from "cloudflare:workers";
import { vi } from "vitest";

import { managedAgents } from "../agent/managed-agents";
import type { ManagedAgents } from "../agent/managed-agents";
import { workerFetch } from "./connector-session";
import { FAKE_MANAGED_AGENTS_ORIGIN } from "./test-origin";

export const fakeManagedAgentsApi = (): FakeManagedAgents =>
  fakeManagedAgents({ connectorFetch: workerFetch });

// the fake answering at the address the suites bind (vitest.config.ts), so a cell's own client,
// the one its alarm and the Worker's webhook use, reaches it as `vite dev`'s reaches the served
// one; every other request goes where it was going. A cell made before this keeps the client it
// made. The answer stops serving it
export const serveInProcess = (api: FakeManagedAgents): (() => void) => {
  const passOn = globalThis.fetch;
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    return new URL(request.url).origin === FAKE_MANAGED_AGENTS_ORIGIN
      ? await api.fetch(request)
      : await passOn(request);
  });
  return () => {
    spy.mockRestore();
  };
};

// the client every suite's cell makes of its own bindings: the fake's, at its address
export const servedAgents = (): ManagedAgents => {
  const agents = managedAgents(env);
  if (agents === null) {
    throw new Error("the suites bind the fake's address");
  }
  return agents;
};

// what a deployment whose agent was applied, and whose key is set, binds: the ids its lockfile
// recorded and its secret, and no fake, which only `vite dev` declares
export const deployedEnv: Env = {
  ...env,
  AGENT_ENVIRONMENT_ID: "env_011CZkZ9",
  AGENT_ID: "agent_011CZkZ8",
  AGENT_VERSION: "3",
  ANTHROPIC_API_KEY: "sk-ant-test",
  MANAGED_AGENTS_FAKE_URL: undefined,
};

// a deployment's client over the fake
export const managedAgentsOver = (api: { readonly fetch: typeof fetch }): ManagedAgents => {
  const agents = managedAgents(deployedEnv, api.fetch);
  if (agents === null) {
    throw new Error("a deployment with a key and an applied agent has a client");
  }
  return agents;
};
