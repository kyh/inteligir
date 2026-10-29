import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { connectorAuth } from "../connector/connector-auth";
import type { CellResult } from "../library/cell-refusal";
import { ORIGIN } from "../test-support/cloud-helpers";
import { CONNECTOR_URL, connectorClient } from "../test-support/connector-session";
import {
  agentCellIn,
  cellOf,
  clockAt,
  engineIn,
  inCell,
  refusalOf,
} from "../test-support/library-cell";
import type { Clock } from "../test-support/library-cell";
import { fakeManagedAgentsApi, managedAgentsOver } from "../test-support/managed-agents-api";
import {
  agentEnabled,
  repairAgentAccess,
  runAgentJobs,
  turnAgentOff,
  turnAgentOn,
} from "./agent-access";
import type { AgentCell } from "./agent-access";

type FakeApi = ReturnType<typeof fakeManagedAgentsApi>;

const UNAVAILABLE = { kind: "agent-unavailable" };

// a turn-on outlasts at most this
const LEASE_MS = 2 * 60_000;

const credentialSchema = z.object({
  auth: z.object({
    access_token: z.string().min(1),
    expires_at: z.string(),
    mcp_server_url: z.string(),
    refresh: z.object({
      client_id: z.string().min(1),
      refresh_token: z.string().min(1),
      resource: z.string(),
      scope: z.string(),
      token_endpoint: z.string(),
      token_endpoint_auth: z.object({ type: z.literal("none") }),
    }),
    type: z.literal("mcp_oauth"),
  }),
  vaultId: z.string(),
});

const valueOf = <T>(result: CellResult<T>): T => {
  if (!result.ok) {
    throw new Error(`the cell refused: ${result.refusal.kind}`);
  }
  return result.value;
};

// the one credential the recorded API holds
const heldCredential = (api: FakeApi) => {
  const held = [...api.credentials.values()];
  expect(held).toHaveLength(1);
  return credentialSchema.parse(held[0]);
};

const grantsOf = async (accountId: string) => {
  const listed = await connectorAuth(env).helpers.listUserGrants(accountId);
  return listed.items;
};

const jobsIn = (state: DurableObjectState): string[] =>
  state.storage.sql
    .exec("SELECT kind FROM jobs WHERE kind LIKE 'agent-%' ORDER BY kind")
    .toArray()
    .map((row) => String(row["kind"]));

// the tools the connector lists to a client holding `token`
const toolCountFor = async (token: string): Promise<number> => {
  const client = await connectorClient(token);
  const listed = await client.listTools();
  await client.close();
  return listed.tools.length;
};

// what the recorded API was asked for, method and path, from `since` on
const asked = (api: FakeApi, since = 0): string[] =>
  api.calls.slice(since).map((call) => `${call.method} ${call.path}`);

interface AgentTest {
  readonly api: FakeApi;
  readonly cell: AgentCell;
  readonly clock: Clock;
  readonly state: DurableObjectState;
}

// a fresh account's cell whose deployment has a key, over the recorded API; `around` sees each
// request before the API does, as a call landing meanwhile would
const inAgentCell = async (
  run: (test: AgentTest) => Promise<void>,
  around?: (request: Request, test: AgentTest) => Promise<void>,
): Promise<void> => {
  const api = fakeManagedAgentsApi();
  const clock = clockAt(Date.now());
  await inCell(cellOf(), async (state) => {
    const library = engineIn(state, clock);
    let current: AgentTest | null = null;
    const agents = managedAgentsOver({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (around !== undefined && current !== null) {
          await around(request.clone(), current);
        }
        return await api.fetch(request);
      },
    });
    current = { api, cell: agentCellIn(state, library, { agents, clock }), clock, state };
    await run(current);
  });
};

describe("turning the built-in agent on", () => {
  it("grants it once, in one vault holding one credential keyed to the connector", async () => {
    await inAgentCell(async ({ api, cell }) => {
      const opId = crypto.randomUUID();
      expect(valueOf(await turnAgentOn(cell, opId))).toEqual({ enabled: true });
      expect(asked(api)).toEqual(["POST /v1/vaults", expect.stringMatching(/credentials$/u)]);
      expect([...api.vaults.values()]).toEqual([{ account_id: cell.accountId }]);
      const { auth } = heldCredential(api);
      expect(auth).toMatchObject({
        mcp_server_url: CONNECTOR_URL,
        refresh: {
          resource: CONNECTOR_URL,
          scope: "library",
          token_endpoint: `${ORIGIN}/oauth/token`,
        },
      });
      const [grant] = await grantsOf(cell.accountId);
      expect(grant?.clientId).toBe(auth.refresh.client_id);
      // the token Anthropic holds is one the connector takes
      expect(await toolCountFor(auth.access_token)).toBeGreaterThan(0);
      expect(valueOf(agentEnabled(cell.library))).toBe(true);

      // on already, and the same op answered again: nothing more is made
      const before = api.calls.length;
      expect(valueOf(await turnAgentOn(cell, crypto.randomUUID()))).toEqual({ enabled: true });
      expect(valueOf(await turnAgentOn(cell, opId))).toEqual({ enabled: true });
      expect(api.calls).toHaveLength(before);
      expect(await grantsOf(cell.accountId)).toHaveLength(1);
    });
  });

  it("fails closed in a deployment with no key: nothing granted and nothing asked", async () => {
    await inCell(cellOf(), async (state) => {
      const cell = agentCellIn(state, engineIn(state, clockAt()));
      expect(refusalOf(await turnAgentOn(cell, crypto.randomUUID()))).toEqual(UNAVAILABLE);
      expect(valueOf(agentEnabled(cell.library))).toBe(false);
      expect(await grantsOf(cell.accountId)).toEqual([]);
    });
  });

  it("takes down what it made when a call to Anthropic fails", async () => {
    await inAgentCell(async ({ api, cell, state }) => {
      api.failNext("POST", /\/credentials$/u);
      expect(refusalOf(await turnAgentOn(cell, crypto.randomUUID()))).toEqual(UNAVAILABLE);
      expect(api.vaults.size).toBe(0);
      expect(await grantsOf(cell.accountId)).toEqual([]);
      expect(valueOf(agentEnabled(cell.library))).toBe(false);
      expect(jobsIn(state)).toEqual([]);
    });
  });

  it("stays off, and takes down what it made, when turned off while turning on", async () => {
    await inAgentCell(
      async ({ api, cell }) => {
        expect(refusalOf(await turnAgentOn(cell, crypto.randomUUID()))).toEqual(UNAVAILABLE);
        expect(api.vaults.size).toBe(0);
        expect(api.credentials.size).toBe(0);
        expect(await grantsOf(cell.accountId)).toEqual([]);
        expect(valueOf(agentEnabled(cell.library))).toBe(false);
      },
      async (request, { cell }) => {
        if (request.method === "POST" && new URL(request.url).pathname === "/v1/vaults") {
          expect(valueOf(await turnAgentOff(cell, crypto.randomUUID()))).toEqual({
            enabled: false,
          });
        }
      },
    );
  });

  it("takes over a turn-on the platform ended part way, once its hold runs out", async () => {
    await inAgentCell(async ({ api, cell, clock, state }) => {
      const stale = await cell.agents?.client.beta.vaults.create({ display_name: "left behind" });
      state.storage.sql.exec(
        "INSERT INTO agent_vault (account_id, started_at, vault_id) VALUES (?, ?, ?)",
        cell.accountId,
        clock.now,
        stale?.id ?? "",
      );
      expect(refusalOf(await turnAgentOn(cell, crypto.randomUUID()))).toEqual(UNAVAILABLE);
      clock.now += LEASE_MS;
      expect(valueOf(await turnAgentOn(cell, crypto.randomUUID()))).toEqual({ enabled: true });
      expect(jobsIn(state)).toEqual(["agent-teardown"]);
      await runAgentJobs(cell);
      expect([...api.vaults.keys()]).not.toContain(stale?.id);
      expect(api.vaults.size).toBe(1);
      expect(jobsIn(state)).toEqual([]);
    });
  });
});

describe("turning the built-in agent off", () => {
  it("revokes the grant and deletes the vault at once, and nothing grants it again", async () => {
    await inAgentCell(async ({ api, cell, state }) => {
      valueOf(await turnAgentOn(cell, crypto.randomUUID()));
      const { auth } = heldCredential(api);
      expect(valueOf(await turnAgentOff(cell, crypto.randomUUID()))).toEqual({ enabled: false });
      expect(api.vaults.size).toBe(0);
      expect(await grantsOf(cell.accountId)).toEqual([]);
      expect(await connectorAuth(env).helpers.unwrapToken(auth.access_token)).toBeNull();
      expect(jobsIn(state)).toEqual([]);
      // a failure reported afterwards finds nothing to repair, and asks nothing
      const before = api.calls.length;
      api.validateAs("invalid");
      expect(await repairAgentAccess(cell)).toBe("off");
      expect(api.calls).toHaveLength(before);
      expect(await grantsOf(cell.accountId)).toEqual([]);
      expect(valueOf(agentEnabled(cell.library))).toBe(false);
    });
  });

  it("leaves a vault Anthropic would not delete to the alarm, which deletes it", async () => {
    await inAgentCell(async ({ api, cell, clock, state }) => {
      valueOf(await turnAgentOn(cell, crypto.randomUUID()));
      api.failNext("DELETE", /^\/v1\/vaults\//u);
      valueOf(await turnAgentOff(cell, crypto.randomUUID()));
      expect(await grantsOf(cell.accountId)).toEqual([]);
      expect(api.vaults.size).toBe(1);
      expect(jobsIn(state)).toEqual(["agent-teardown"]);
      await runAgentJobs(cell);
      expect(api.vaults.size).toBe(1);
      clock.now += 60_000;
      await runAgentJobs(cell);
      expect(api.vaults.size).toBe(0);
      expect(jobsIn(state)).toEqual([]);
    });
  });
});

describe("repairing the built-in agent's credential", () => {
  it("re-grants only a credential Anthropic judges invalid", async () => {
    await inAgentCell(async ({ api, cell, state }) => {
      valueOf(await turnAgentOn(cell, crypto.randomUUID()));
      const first = heldCredential(api).auth;
      const [granted] = await grantsOf(cell.accountId);
      const updates = (since: number) =>
        asked(api, since).filter((call) => /credentials\/[^/]+$/u.test(call));

      let since = api.calls.length;
      expect(await repairAgentAccess(cell)).toBe("valid");
      expect(updates(since)).toEqual([]);

      api.validateAs("unknown");
      since = api.calls.length;
      expect(await repairAgentAccess(cell)).toBe("later");
      expect(updates(since)).toEqual([]);
      expect(jobsIn(state)).toEqual(["agent-repair"]);

      api.validateAs("invalid");
      since = api.calls.length;
      expect(await repairAgentAccess(cell)).toBe("repaired");
      expect(updates(since)).toHaveLength(1);
      const repaired = heldCredential(api).auth;
      expect(repaired.access_token).not.toBe(first.access_token);
      expect(repaired.refresh.refresh_token).not.toBe(first.refresh.refresh_token);
      // the client, endpoint, resource and scope the credential refreshes with stay as they were
      expect(repaired.refresh).toMatchObject({
        ...first.refresh,
        refresh_token: expect.any(String),
      });
      const grants = await grantsOf(cell.accountId);
      expect(grants).toHaveLength(1);
      expect(grants[0]?.id).not.toBe(granted?.id);
      expect(await toolCountFor(repaired.access_token)).toBeGreaterThan(0);
    });
  });
});
