// The fake driven by the real SDK, as the cell drives it: a vault's credential reaches a connector
// of the suite's own, each turn's events are listed and streamed in the shapes the API reference
// records, a budget pauses before the request that would pass it, a call that asks waits for its
// confirmation, and an interrupt ends a running turn.

import Anthropic from "@anthropic-ai/sdk";
import type { BetaManagedAgentsStreamSessionEvents } from "@anthropic-ai/sdk/resources/beta/sessions/events";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { fakeManagedAgents } from "./fake-api.ts";

const CONNECTOR = "https://library.test/connector";
const TOKEN_ENDPOINT = "https://library.test/oauth/token";

// a connector holding one tool, which answers only the token it last minted
const connector = () => {
  const created: string[] = [];
  let token = "token-1";
  const handler = createMcpHandler(
    () => {
      const server = new McpServer({ name: "library", version: "1.0.0" });
      server.registerTool("create_note", { inputSchema: { title: z.string() } }, ({ title }) => {
        created.push(title);
        return { content: [{ text: `made ${title}`, type: "text" as const }] };
      });
      server.registerTool("delete_items", { inputSchema: { ids: z.array(z.string()) } }, () => ({
        content: [{ text: "deleted", type: "text" as const }],
      }));
      return server;
    },
    { legacy: "stateless" },
  );
  return {
    created,
    expire: () => {
      token = "token-2";
    },
    fetch: async (request: Request): Promise<Response> => {
      if (request.url === TOKEN_ENDPOINT) {
        return Response.json({ access_token: token, expires_in: 3600, refresh_token: "refresh-2" });
      }
      return request.headers.get("authorization") === `Bearer ${token}`
        ? await handler.fetch(request)
        : new Response("unauthorized", { status: 401 });
    },
  };
};

const AGENT = {
  id: "agent_fake",
  mcp_servers: [{ name: "library", type: "url" as const, url: CONNECTOR }],
  tools: [
    {
      configs: [
        {
          enabled: true,
          name: "create_note",
          permission_policy: { type: "always_allow" as const },
        },
        { enabled: true, name: "delete_items", permission_policy: { type: "always_ask" as const } },
      ],
      default_config: { enabled: false },
      mcp_server_name: "library",
      type: "mcp_toolset" as const,
    },
  ],
  type: "agent_with_overrides" as const,
  version: 1,
};

const message = (text: string) => ({
  content: [{ text, type: "text" as const }],
  type: "user.message" as const,
});

const setUp = async () => {
  const library = connector();
  const api = fakeManagedAgents({ connectorFetch: library.fetch });
  const client = new Anthropic({
    apiKey: "sk-fake",
    baseURL: "https://api.test",
    fetch: api.fetch,
  });
  const vault = await client.beta.vaults.create({ display_name: "Library" });
  await client.beta.vaults.credentials.create(vault.id, {
    auth: {
      access_token: "token-1",
      expires_at: "2026-11-01T00:00:00Z",
      mcp_server_url: CONNECTOR,
      refresh: {
        client_id: "built-in",
        refresh_token: "refresh-1",
        token_endpoint: TOKEN_ENDPOINT,
        token_endpoint_auth: { type: "none" },
      },
      type: "mcp_oauth",
    },
  });
  return { api, client, library, vaultId: vault.id };
};

const typesOf = (events: readonly { readonly type: string }[]): string[] =>
  events.map((event) => event.type);

describe("the fake Managed Agents API", () => {
  it("runs a seeded turn through the connector with the vault's token, and lists it", async () => {
    const { api, client, library, vaultId } = await setUp();
    const session = await client.beta.sessions.create({
      agent: AGENT,
      environment_id: "env_fake",
      initial_events: [message('Please.\ncall create_note {"title":"Paris"}')],
      metadata: { accountId: "a", threadId: "t" },
      vault_ids: [vaultId],
    });
    expect(session.status).toBe("running");
    await api.settled();
    expect(library.created).toEqual(["Paris"]);
    const listed = await client.beta.sessions.events.list(session.id);
    expect(typesOf(listed.data)).toEqual([
      "user.message",
      "session.status_running",
      "span.model_request_start",
      "span.model_request_end",
      "agent.mcp_tool_use",
      "agent.mcp_tool_result",
      "span.model_request_start",
      "span.model_request_end",
      "agent.message",
      "session.usage",
      "session.status_idle",
    ]);
    expect(listed.data.at(-1)).toMatchObject({ stop_reason: { type: "end_turn" } });
    expect(listed.data[4]).toMatchObject({ evaluated_permission: "allow", name: "create_note" });
    const retrieved = await client.beta.sessions.retrieve(session.id);
    expect(retrieved).toMatchObject({ metadata: { threadId: "t" }, status: "idle" });
    expect(retrieved.usage.list_cost).toEqual({ amount: "2", currency: "USD" });
  });

  it("streams events as they happen, previewing the agent's message on a connection that asks", async () => {
    const { api, client, vaultId } = await setUp();
    const session = await client.beta.sessions.create({
      agent: AGENT,
      environment_id: "env_fake",
      vault_ids: [vaultId],
    });
    const stream = await client.beta.sessions.events.stream(session.id, {
      event_deltas: ["agent.message"],
    });
    await client.beta.sessions.events.send(session.id, { events: [message("Hello.")] });
    const seen: BetaManagedAgentsStreamSessionEvents[] = [];
    for await (const event of stream) {
      seen.push(event);
      if (event.type === "session.status_idle") {
        break;
      }
    }
    await api.settled();
    expect(typesOf(seen)).toContain("event_start");
    expect(typesOf(seen).indexOf("event_delta")).toBeLessThan(
      typesOf(seen).indexOf("agent.message"),
    );
    const listed = await client.beta.sessions.events.list(session.id, {
      types: ["agent.message"],
    });
    expect(listed.data).toHaveLength(1);
  });

  it("idles on an approval, refuses a message meanwhile, and runs the call once allowed", async () => {
    const { api, client, vaultId } = await setUp();
    const session = await client.beta.sessions.create({
      agent: AGENT,
      environment_id: "env_fake",
      initial_events: [message('call delete_items {"ids":["x"]}')],
      vault_ids: [vaultId],
    });
    await api.settled();
    const { data } = await client.beta.sessions.events.list(session.id, { order: "desc" });
    const paused = data.find((event) => event.type === "session.status_idle");
    expect(paused).toMatchObject({ stop_reason: { type: "requires_action" } });
    const ask = data.find((event) => event.type === "agent.mcp_tool_use");
    expect(ask).toMatchObject({ evaluated_permission: "ask" });
    await expect(
      client.beta.sessions.events.send(session.id, { events: [message("Go on.")] }),
    ).rejects.toThrow(/settle events/u);
    await client.beta.sessions.events.send(session.id, {
      events: [{ result: "allow", tool_use_id: ask?.id ?? "", type: "user.tool_confirmation" }],
    });
    await api.settled();
    const after = await client.beta.sessions.events.list(session.id, { order: "desc" });
    expect(after.data[0]).toMatchObject({ stop_reason: { type: "end_turn" } });
    expect(after.data.find((event) => event.type === "agent.mcp_tool_result")).toMatchObject({
      is_error: false,
    });
  });

  it("pauses at its budget before the request that would pass it, until the cap is raised", async () => {
    const { api, client, vaultId } = await setUp();
    const session = await client.beta.sessions.create({
      agent: AGENT,
      budget: { max_list_cost: { amount: "40", currency: "USD" }, type: "limit" },
      environment_id: "env_fake",
      initial_events: [message("spend 30\nspend 30\nspend 30")],
      vault_ids: [vaultId],
    });
    await api.settled();
    const paused = await client.beta.sessions.retrieve(session.id);
    expect(paused.usage.list_cost?.amount).toBe("60");
    const { data } = await client.beta.sessions.events.list(session.id, { order: "desc" });
    expect(typesOf(data.slice(0, 2))).toEqual(["session.status_idle", "session.usage"]);
    expect(data[0]).toMatchObject({ stop_reason: { type: "budget_reached" } });
    await expect(
      client.beta.sessions.update(session.id, {
        budget: { max_list_cost: { amount: "50", currency: "USD" }, type: "limit" },
      }),
    ).rejects.toThrow(/budget_not_raised/u);
    await client.beta.sessions.update(session.id, {
      budget: { max_list_cost: { amount: "500", currency: "USD" }, type: "limit" },
    });
    await api.settled();
    const done = await client.beta.sessions.events.list(session.id, { order: "desc" });
    expect(done.data[0]).toMatchObject({ stop_reason: { type: "end_turn" } });
  });

  it("ends a running turn at an interrupt with end_turn, and refreshes a lapsed token", async () => {
    const { api, client, library, vaultId } = await setUp();
    library.expire();
    const session = await client.beta.sessions.create({
      agent: AGENT,
      environment_id: "env_fake",
      initial_events: [message('call create_note {"title":"Rome"}\nstall')],
      vault_ids: [vaultId],
    });
    await expect.poll(() => api.sessions.get(session.id)?.events.length ?? 0).toBeGreaterThan(6);
    expect(library.created).toEqual(["Rome"]);
    await client.beta.sessions.events.send(session.id, { events: [{ type: "user.interrupt" }] });
    await api.settled();
    const { data } = await client.beta.sessions.events.list(session.id, { order: "desc" });
    expect(data[0]).toMatchObject({ stop_reason: { type: "end_turn" } });
    expect(typesOf(data)).toContain("user.interrupt");
    expect(typesOf(data)).not.toContain("agent.message");
    await client.beta.sessions.delete(session.id);
    expect(api.sessions.has(session.id)).toBe(false);
  });
});
