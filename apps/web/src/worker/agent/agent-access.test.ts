import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { connectorAuth } from "../connector/connector-auth";
import type { CellResult } from "../library/cell-refusal";
import { ORIGIN, signUpUser, userIdOf } from "../test-support/cloud-helpers";
import {
  CONNECTOR_URL,
  connectAssistant,
  connectorClient,
} from "../test-support/connector-session";
import {
  agentCellIn,
  cellOf,
  clockAt,
  engineIn,
  inCell,
  newAccountId,
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
import { grantBuiltInAgent } from "./built-in-client";

type FakeApi = ReturnType<typeof fakeManagedAgentsApi>;

const UNAVAILABLE = { kind: "agent-unavailable" };

// a turn-on or a repair holds the row at most this
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

// the grant a token was minted under, null once it is revoked
const grantOfToken = async (token: string): Promise<string | null> => {
  const minted = await connectorAuth(env).helpers.unwrapToken(token);
  return minted?.grantId ?? null;
};

// a grant of the agent's that no row names, as a call the platform ended after making one leaves
const strayGrant = async (cell: AgentCell) =>
  await grantBuiltInAgent(connectorAuth(env), env, {
    accountId: cell.accountId,
    endpoint: cell.endpoint,
  });

const jobsIn = (state: DurableObjectState): string[] =>
  state.storage.sql
    .exec(
      `SELECT kind FROM jobs WHERE kind IN ('agent-teardown', 'agent-repair', 'agent-start')
       ORDER BY kind`,
    )
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

const isValidation = (request: Request): boolean =>
  new URL(request.url).pathname.endsWith("/mcp_oauth_validate");

const isCredentialUpdate = (request: Request): boolean =>
  request.method === "POST" &&
  /^\/v1\/vaults\/[^/]+\/credentials\/[^/]+$/u.test(new URL(request.url).pathname);

// a step a request waits at until the test lets it through, or fails it as the platform would end
// it (the Worker's program types ES2023, which has no Promise.withResolvers)
interface Gate {
  readonly passed: Promise<true>;
  readonly pass: () => void;
  readonly fail: (cause: Error) => void;
}

// a gate's own settlers, its promise's once it is made
interface Settlers {
  pass: () => void;
  fail: (cause: Error) => void;
}

// what they are for the moment before its promise hands them over, as it does on being made
const unset = (): void => undefined;

const gate = (): Gate => {
  const settlers: Settlers = { fail: unset, pass: unset };
  // oxlint-disable-next-line promise/avoid-new -- the test settles it from outside the request it holds, which only a promise's own settlers can do
  const passed = new Promise<true>((resolve, reject) => {
    settlers.pass = () => {
      resolve(true);
    };
    settlers.fail = reject;
  });
  return {
    fail: (cause) => {
      settlers.fail(cause);
    },
    pass: () => {
      settlers.pass();
    },
    passed,
  };
};

interface AgentTest {
  readonly api: FakeApi;
  readonly cell: AgentCell;
  readonly clock: Clock;
  readonly state: DurableObjectState;
}

// a cell whose deployment has a key, over the recorded API: a fresh account's unless the test
// names one, and `around` sees each request before the API does, as a call landing meanwhile would
const inAgentCell = async (
  run: (test: AgentTest) => Promise<void>,
  options: {
    readonly accountId?: string;
    readonly around?: (request: Request, test: AgentTest) => Promise<void>;
  } = {},
): Promise<void> => {
  const api = fakeManagedAgentsApi();
  const clock = clockAt(Date.now());
  await inCell(cellOf(options.accountId ?? newAccountId()), async (state) => {
    const library = engineIn(state, clock);
    let current: AgentTest | null = null;
    const agents = managedAgentsOver({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (options.around !== undefined && current !== null) {
          await options.around(request.clone(), current);
        }
        return await api.fetch(request);
      },
    });
    current = { api, cell: agentCellIn(state, library, { agents, clock }), clock, state };
    await run(current);
  });
};

// an account an assistant was let into, whose grant no switch of the agent's may touch
const accountWithAssistant = async (email: string) => {
  const { cookie } = await signUpUser(email);
  const assistant = await connectAssistant(cookie);
  return { accountId: await userIdOf(cookie), assistantToken: assistant.access_token };
};

describe("turning the built-in agent on", () => {
  it("grants it once, in one vault holding one credential keyed to the connector", async () => {
    await inAgentCell(async ({ api, cell, state }) => {
      expect(valueOf(await turnAgentOn(cell, crypto.randomUUID()))).toEqual({ enabled: true });
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
      // a turn-on that landed leaves no job behind
      expect(jobsIn(state)).toEqual([]);

      // on already: nothing more is made
      const before = api.calls.length;
      expect(valueOf(await turnAgentOn(cell, crypto.randomUUID()))).toEqual({ enabled: true });
      expect(api.calls).toHaveLength(before);
      expect(await grantsOf(cell.accountId)).toHaveLength(1);
    });
  });

  it("answers its op again as it first answered, though the agent was turned off since", async () => {
    await inAgentCell(async ({ api, cell }) => {
      const opId = crypto.randomUUID();
      valueOf(await turnAgentOn(cell, opId));
      valueOf(await turnAgentOff(cell, crypto.randomUUID()));
      const before = api.calls.length;
      expect(valueOf(await turnAgentOn(cell, opId))).toEqual({ enabled: true });
      // the answer was the op's record: nothing was granted or made again
      expect(api.calls).toHaveLength(before);
      expect(api.vaults.size).toBe(0);
      expect(await grantsOf(cell.accountId)).toEqual([]);
      expect(valueOf(agentEnabled(cell.library))).toBe(false);
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

  it("revokes a grant an earlier attempt made and never named, and no assistant's", async () => {
    const { accountId, assistantToken } = await accountWithAssistant("agent-stray-on@example.test");
    await inAgentCell(
      async ({ api, cell }) => {
        const stray = await strayGrant(cell);
        valueOf(await turnAgentOn(cell, crypto.randomUUID()));
        const { auth } = heldCredential(api);
        expect(await grantOfToken(stray.accessToken)).toBeNull();
        const held = await grantOfToken(auth.access_token);
        expect(held).not.toBeNull();
        expect(await toolCountFor(assistantToken)).toBeGreaterThan(0);
        const grants = await grantsOf(accountId);
        expect(grants.map((grant) => grant.id).toSorted()).toEqual(
          [held, await grantOfToken(assistantToken)].toSorted(),
        );
      },
      { accountId },
    );
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
      async ({ api, cell, state }) => {
        expect(refusalOf(await turnAgentOn(cell, crypto.randomUUID()))).toEqual(UNAVAILABLE);
        expect(api.vaults.size).toBe(0);
        expect(api.credentials.size).toBe(0);
        expect(await grantsOf(cell.accountId)).toEqual([]);
        expect(valueOf(agentEnabled(cell.library))).toBe(false);
        expect(jobsIn(state)).toEqual([]);
      },
      {
        around: async (request, { cell }) => {
          if (request.method === "POST" && new URL(request.url).pathname === "/v1/vaults") {
            expect(valueOf(await turnAgentOff(cell, crypto.randomUUID()))).toEqual({
              enabled: false,
            });
          }
        },
      },
    );
  });

  it("lets go of a turn-on the platform ended part way, by its job once its hold runs out", async () => {
    const reached = gate();
    const ended = gate();
    await inAgentCell(
      async ({ api, cell, clock, state }) => {
        const startedAt = clock.now;
        const pending = turnAgentOn(cell, crypto.randomUUID());
        // the grant and the vault are made and named on the row, and the credential is asked for
        await reached.passed;
        expect(api.vaults.size).toBe(1);
        expect(await grantsOf(cell.accountId)).toHaveLength(1);
        // the alarm is set for the let-go though the call has not ended, as an evicted cell's is
        expect(await state.storage.getAlarm()).toBe(startedAt + LEASE_MS);
        expect(jobsIn(state)).toEqual(["agent-start"]);
        await runAgentJobs(cell);
        expect(api.vaults.size).toBe(1);
        clock.now += LEASE_MS;
        await runAgentJobs(cell);
        expect(api.vaults.size).toBe(0);
        expect(await grantsOf(cell.accountId)).toEqual([]);
        expect(valueOf(agentEnabled(cell.library))).toBe(false);
        expect(jobsIn(state)).toEqual([]);
        // the call the platform ended never answers; here it does, and finds its row gone
        ended.fail(new Error("the platform ended the call"));
        expect(refusalOf(await pending)).toEqual(UNAVAILABLE);
        expect(api.credentials.size).toBe(0);
        expect(jobsIn(state)).toEqual([]);
      },
      {
        around: async (request) => {
          if (request.method === "POST" && new URL(request.url).pathname.endsWith("/credentials")) {
            reached.pass();
            await ended.passed;
          }
        },
      },
    );
  });

  it("takes over a row an attempt left past its hold, before its job lets it go", async () => {
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
    const { accountId, assistantToken } = await accountWithAssistant("agent-off@example.test");
    await inAgentCell(
      async ({ api, cell, state }) => {
        valueOf(await turnAgentOn(cell, crypto.randomUUID()));
        const { auth } = heldCredential(api);
        const stray = await strayGrant(cell);
        expect(valueOf(await turnAgentOff(cell, crypto.randomUUID()))).toEqual({
          enabled: false,
        });
        expect(api.vaults.size).toBe(0);
        // the agent's grants go, a stray one's with them, and the assistant's stays
        expect(await grantOfToken(auth.access_token)).toBeNull();
        expect(await grantOfToken(stray.accessToken)).toBeNull();
        const left = await grantsOf(accountId);
        expect(left.map((grant) => grant.id)).toEqual([await grantOfToken(assistantToken)]);
        expect(jobsIn(state)).toEqual([]);
        // a failure reported afterwards finds nothing to repair, and asks nothing
        const before = api.calls.length;
        api.validateAs("invalid");
        expect(await repairAgentAccess(cell)).toBe("off");
        expect(api.calls).toHaveLength(before);
        expect(await grantsOf(accountId)).toHaveLength(1);
        expect(valueOf(agentEnabled(cell.library))).toBe(false);
      },
      { accountId },
    );
  });

  it("answers its op again as it first answered, though the agent was turned on since", async () => {
    await inAgentCell(async ({ api, cell }) => {
      valueOf(await turnAgentOn(cell, crypto.randomUUID()));
      const opId = crypto.randomUUID();
      valueOf(await turnAgentOff(cell, opId));
      valueOf(await turnAgentOn(cell, crypto.randomUUID()));
      const before = api.calls.length;
      expect(valueOf(await turnAgentOff(cell, opId))).toEqual({ enabled: false });
      // the answer was the op's record: the vault and grant made since are left alone
      expect(api.calls).toHaveLength(before);
      expect(api.vaults.size).toBe(1);
      expect(await grantsOf(cell.accountId)).toHaveLength(1);
      expect(valueOf(agentEnabled(cell.library))).toBe(true);
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
      // the grant it replaced is revoked once the credential holds the new one
      expect(await grantOfToken(first.access_token)).toBeNull();
      const grants = await grantsOf(cell.accountId);
      expect(grants).toHaveLength(1);
      expect(grants[0]?.id).not.toBe(granted?.id);
      expect(await toolCountFor(repaired.access_token)).toBeGreaterThan(0);
      expect(jobsIn(state)).toEqual(["agent-repair"]);
    });
  });

  it("runs one repair at a time, so two at once leave the credential a token that opens", async () => {
    // were both to make a grant, the first's would be handed to Anthropic after the second's: the
    // second's validation waits until the first's update is sent, which waits until one repair ends
    const firstUpdateSent = gate();
    const oneEnded = gate();
    let validations = 0;
    let updates = 0;
    await inAgentCell(
      async ({ api, cell, state }) => {
        valueOf(await turnAgentOn(cell, crypto.randomUUID()));
        const first = heldCredential(api).auth;
        api.validateAs("invalid");
        const answers = await Promise.all(
          [repairAgentAccess(cell), repairAgentAccess(cell)].map(async (repair) => {
            try {
              return await repair;
            } finally {
              oneEnded.pass();
            }
          }),
        );
        expect(answers.toSorted()).toEqual(["later", "repaired"]);
        expect(updates).toBe(1);
        const { auth } = heldCredential(api);
        expect(await toolCountFor(auth.access_token)).toBeGreaterThan(0);
        expect(await grantOfToken(first.access_token)).toBeNull();
        const grants = await grantsOf(cell.accountId);
        expect(grants.map((grant) => grant.id)).toEqual([await grantOfToken(auth.access_token)]);
        // the one that met the other under way asks again later
        expect(jobsIn(state)).toEqual(["agent-repair"]);
      },
      {
        around: async (request) => {
          if (isValidation(request)) {
            validations += 1;
            if (validations === 2) {
              await firstUpdateSent.passed;
            }
          }
          if (isCredentialUpdate(request)) {
            updates += 1;
            if (updates === 1) {
              firstUpdateSent.pass();
              await oneEnded.passed;
            }
          }
        },
      },
    );
  });

  it("hands a lease that ran out to the next repair, and the first lets its own grant go", async () => {
    let tookOver = false;
    await inAgentCell(
      async ({ api, cell }) => {
        valueOf(await turnAgentOn(cell, crypto.randomUUID()));
        api.validateAs("invalid");
        expect(await repairAgentAccess(cell)).toBe("later");
        expect(tookOver).toBe(true);
        const { auth } = heldCredential(api);
        expect(await toolCountFor(auth.access_token)).toBeGreaterThan(0);
        const grants = await grantsOf(cell.accountId);
        expect(grants.map((grant) => grant.id)).toEqual([await grantOfToken(auth.access_token)]);
      },
      {
        around: async (request, { cell, clock }) => {
          if (!tookOver && isValidation(request)) {
            // the first repair waits on Anthropic past its lease, and the next takes the row
            tookOver = true;
            clock.now += LEASE_MS;
            expect(await repairAgentAccess(cell)).toBe("repaired");
          }
        },
      },
    );
  });
});
