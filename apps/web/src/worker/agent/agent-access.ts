// The built-in agent's access to the account's library, which the person switches on and off
// (`library.agent.setEnabled`). While it is on the account holds one grant of the built-in OAuth
// client (`./built-in-client`) and one Managed Agents vault holding one `mcp_oauth` credential for
// the connector, which every session the cell starts names, so Anthropic's proxy adds the token to
// each of the agent's calls and refreshes it at this Worker's token endpoint
// (platform.claude.com/docs/en/managed-agents/vaults). The `agent_vault` row is the switch. A
// turn-on claims it, writes each id onto it as its call returns, and reads it again after every call
// that leaves the cell, since other calls land meanwhile (a turn-off, a second turn-on, the
// account's deletion); one that finds the row no longer its own takes down what it made. Turning
// it off deletes the row and takes the grant and the vault down at once, a job retrying until both
// are gone, and nothing but the person turns it on again: a repair of a credential that is off
// finds nothing to repair, so no failure re-grants it.

import { z } from "zod";

import type { SqlStatements } from "@repo/notes/library/library-sql";

import { connectorAuth } from "../connector/connector-auth";
import type { LibraryEngine } from "../library/library-engine";
import type { LandingScope } from "../library/cell-landing";
import { dropJob, dueJobs, retryJob, scheduleJob, waitingJobs } from "../library/cell-jobs";
import type { DueJob } from "../library/cell-jobs";
import { refuse } from "../library/cell-refusal";
import type { CellResult } from "../library/cell-refusal";
import { grantBuiltInAgent } from "./built-in-client";
import type { BuiltInGrant, TokenEndpoint } from "./built-in-client";
import { callFailureFields, isGone } from "./managed-agents";
import type { ManagedAgents } from "./managed-agents";

// the account's cell as its agent's access needs it
export interface AgentCell {
  readonly accountId: string;
  readonly env: Env;
  readonly library: LibraryEngine;
  // null when this deployment has no key or no applied agent: nothing is asked of Anthropic, and
  // turning the agent on is refused
  readonly agents: ManagedAgents | null;
  // the Worker, whose token endpoint the grant's code is traded at
  readonly endpoint: TokenEndpoint;
  readonly now: () => number;
}

const switchedSchema = z.object({ enabled: z.boolean() });

type Switched = z.infer<typeof switchedSchema>;

// what the vault and its credential are called in Anthropic's console
const VAULT_NAME = "Inteligir library";

// a turn-on's hold on the row: past it, an attempt the platform ended part way is taken over. It
// outlasts a whole turn-on, two calls to Anthropic at most 30 seconds each and the grant's own
const LEASE_MS = 2 * 60_000;

// a takedown a turn-off runs at once is asked again this long after, if it did not finish
const TEARDOWN_AGAIN_MS = 60_000;

// a credential whose verdict Anthropic could not reach is checked again after this
const REPAIR_AGAIN_MS = 5 * 60_000;

// an interrupted session settles a moment later, and is asked this many times before its deletion
const SETTLE_POLLS = 10;

const REPAIR_JOB = { id: "agent-repair", kind: "agent-repair", payload: "{}" } as const;

const UNAVAILABLE = { ok: false, refusal: { kind: "agent-unavailable" } } as const;

// ---- the row ----

type Access =
  | {
      readonly kind: "starting";
      readonly startedAt: number;
      readonly grantId: string | null;
      readonly vaultId: string | null;
    }
  | {
      readonly kind: "on";
      readonly startedAt: number;
      readonly grantId: string;
      readonly vaultId: string;
      readonly credentialId: string;
    };

const accessRowSchema = z.object({
  credential_id: z.string().nullable(),
  grant_id: z.string().nullable(),
  started_at: z.number().int(),
  vault_id: z.string().nullable(),
});

const accessOf = (sql: SqlStatements): Access | null => {
  const [raw] = sql.all(
    "SELECT started_at, grant_id, vault_id, credential_id FROM agent_vault",
    [],
  );
  if (raw === undefined) {
    return null;
  }
  const row = accessRowSchema.parse(raw);
  return row.credential_id !== null && row.grant_id !== null && row.vault_id !== null
    ? {
        credentialId: row.credential_id,
        grantId: row.grant_id,
        kind: "on",
        startedAt: row.started_at,
        vaultId: row.vault_id,
      }
    : { grantId: row.grant_id, kind: "starting", startedAt: row.started_at, vaultId: row.vault_id };
};

// the row a turn-on claimed at `startedAt`, still its own: neither turned off nor taken over
const ownedBy = (sql: SqlStatements, startedAt: number): boolean => {
  const held = accessOf(sql);
  return held?.kind === "starting" && held.startedAt === startedAt;
};

// ---- taking it down ----

// what a grant and a vault left to take down name; either may be missing
const leftoversSchema = z.object({
  grantId: z.string().nullable(),
  vaultId: z.string().nullable(),
});

type Leftovers = z.infer<typeof leftoversSchema>;

const NOTHING: Leftovers = { grantId: null, vaultId: null };

const teardownJobId = (leftovers: Leftovers): string =>
  `agent-teardown:${leftovers.grantId ?? ""}:${leftovers.vaultId ?? ""}`;

// a takedown asked for in the transaction that lets the row go, so one the cell's eviction cut
// short is run again by the alarm
const queueTeardown = (sql: SqlStatements, leftovers: Leftovers, at: number): void => {
  if (leftovers.grantId !== null || leftovers.vaultId !== null) {
    scheduleJob(
      sql,
      { id: teardownJobId(leftovers), kind: "agent-teardown", payload: JSON.stringify(leftovers) },
      at,
    );
  }
};

// the grant revoked first, so its tokens stop working even while the vault is still Anthropic's;
// either already gone is done
const tearDown = async (cell: AgentCell, leftovers: Leftovers): Promise<void> => {
  if (leftovers.grantId !== null) {
    await connectorAuth(cell.env).helpers.revokeGrant(leftovers.grantId, cell.accountId);
  }
  if (leftovers.vaultId === null) {
    return;
  }
  if (cell.agents === null) {
    throw new Error("the agent's vault is Anthropic's to delete, and this deployment holds no key");
  }
  try {
    await cell.agents.client.beta.vaults.delete(leftovers.vaultId);
  } catch (error) {
    if (!isGone(error)) {
      throw error;
    }
  }
};

const inTransaction = (library: LibraryEngine, work: (scope: LandingScope) => void) =>
  library.landApart({ answer: z.literal(true), opId: undefined }, (scope) => {
    work(scope);
    return true as const;
  });

// a queued takedown run now, and its job dropped once it is done; one that fails waits for the alarm
const runTeardown = async (cell: AgentCell, leftovers: Leftovers): Promise<void> => {
  if (leftovers.grantId === null && leftovers.vaultId === null) {
    return;
  }
  try {
    await tearDown(cell, leftovers);
  } catch (error) {
    console.warn({ event: "agent-teardown-failed", ...callFailureFields(error) });
    return;
  }
  inTransaction(cell.library, (scope) => {
    dropJob(scope.storage, teardownJobId(leftovers));
  });
};

// what a turn-on made, let go of: its row, while still its own, and the grant and vault it made,
// taken down at once. A deleted account refuses the queue, and the takedown is tried all the same
const abandon = async (
  cell: AgentCell,
  startedAt: number,
  made: Leftovers,
): Promise<CellResult<never>> => {
  const released = inTransaction(cell.library, (scope) => {
    if (ownedBy(scope.storage, startedAt)) {
      scope.storage.run("DELETE FROM agent_vault", []);
    }
    queueTeardown(scope.storage, made, scope.now + TEARDOWN_AGAIN_MS);
  });
  await runTeardown(cell, made);
  return released.ok ? UNAVAILABLE : released;
};

// ---- turning it on ----

type Claim =
  | { readonly kind: "on" }
  | { readonly kind: "busy" }
  | { readonly kind: "claimed"; readonly startedAt: number };

const claimSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("on") }),
  z.object({ kind: z.literal("busy") }),
  z.object({ kind: z.literal("claimed"), startedAt: z.number() }),
]);

// the row, claimed for a turn-on; one an attempt left past its lease is taken over, what it made
// queued for its takedown
const claim = (scope: LandingScope, accountId: string): Claim => {
  const held = accessOf(scope.storage);
  if (held?.kind === "on") {
    return { kind: "on" };
  }
  if (held !== null && scope.now - held.startedAt < LEASE_MS) {
    return { kind: "busy" };
  }
  if (held !== null) {
    queueTeardown(scope.storage, held, scope.now);
  }
  scope.storage.run(
    `INSERT INTO agent_vault (account_id, started_at) VALUES (?, ?)
     ON CONFLICT (account_id) DO UPDATE SET started_at = excluded.started_at, grant_id = NULL,
       vault_id = NULL, credential_id = NULL`,
    [accountId, scope.now],
  );
  return { kind: "claimed", startedAt: scope.now };
};

// one id a call returned, written onto the row while it is still this turn-on's
const recordOn = (
  cell: AgentCell,
  startedAt: number,
  column: "grant_id" | "vault_id",
  id: string,
): CellResult<true> =>
  inTransaction(cell.library, (scope) => {
    if (!ownedBy(scope.storage, startedAt)) {
      refuse({ kind: "agent-unavailable" });
    }
    scope.storage.run(`UPDATE agent_vault SET ${column} = ?`, [id]);
  });

const credentialAuth = (grant: BuiltInGrant) => ({
  access_token: grant.accessToken,
  expires_at: grant.expiresAt,
  // the session's server is this address, and a credential is matched to it by its url
  mcp_server_url: grant.resource,
  refresh: {
    client_id: grant.clientId,
    refresh_token: grant.refreshToken,
    resource: grant.resource,
    scope: grant.scope,
    token_endpoint: grant.tokenEndpoint,
    token_endpoint_auth: { type: "none" as const },
  },
  type: "mcp_oauth" as const,
});

// the grant, then the vault, then its credential, each id on the row as it comes; a create is
// sent once, since a retry after a lost answer would make a second one nothing names
const provision = async (
  cell: AgentCell,
  agents: ManagedAgents,
  startedAt: number,
  opId: string | undefined,
): Promise<CellResult<Switched>> => {
  let made = NOTHING;
  try {
    const grant = await grantBuiltInAgent(connectorAuth(cell.env), cell.env, {
      accountId: cell.accountId,
      endpoint: cell.endpoint,
    });
    made = { ...made, grantId: grant.grantId };
    if (!recordOn(cell, startedAt, "grant_id", grant.grantId).ok) {
      return await abandon(cell, startedAt, made);
    }
    const vault = await agents.client.beta.vaults.create(
      { display_name: VAULT_NAME, metadata: { account_id: cell.accountId } },
      { maxRetries: 0 },
    );
    made = { ...made, vaultId: vault.id };
    if (!recordOn(cell, startedAt, "vault_id", vault.id).ok) {
      return await abandon(cell, startedAt, made);
    }
    const credential = await agents.client.beta.vaults.credentials.create(
      vault.id,
      { auth: credentialAuth(grant), display_name: VAULT_NAME },
      { maxRetries: 0 },
    );
    const on = cell.library.landApart({ answer: switchedSchema, opId }, (scope) => {
      if (!ownedBy(scope.storage, startedAt)) {
        refuse({ kind: "agent-unavailable" });
      }
      scope.storage.run("UPDATE agent_vault SET credential_id = ?", [credential.id]);
      return { enabled: true };
    });
    return on.ok ? on : await abandon(cell, startedAt, made);
  } catch (error) {
    console.warn({ event: "agent-turn-on-failed", ...callFailureFields(error) });
    return await abandon(cell, startedAt, made);
  }
};

export const turnAgentOn = async (
  cell: AgentCell,
  opId?: string,
): Promise<CellResult<Switched>> => {
  const prior = cell.library.answered(opId, switchedSchema);
  if (!prior.ok) {
    return prior;
  }
  if (prior.value !== null) {
    return { head: null, ok: true, value: prior.value };
  }
  if (cell.agents === null) {
    return UNAVAILABLE;
  }
  const claimed = cell.library.landApart({ answer: claimSchema, opId: undefined }, (scope) =>
    claim(scope, cell.accountId),
  );
  if (!claimed.ok) {
    return claimed;
  }
  switch (claimed.value.kind) {
    case "on": {
      return cell.library.landApart({ answer: switchedSchema, opId }, () => ({ enabled: true }));
    }
    // another turn-on is under way, and the person's next try meets its end
    case "busy": {
      return UNAVAILABLE;
    }
    case "claimed": {
      return await provision(cell, cell.agents, claimed.value.startedAt, opId);
    }
    // no default
  }
};

// ---- turning it off ----

export const turnAgentOff = async (
  cell: AgentCell,
  opId?: string,
): Promise<CellResult<Switched>> => {
  let leftovers = NOTHING;
  const off = cell.library.landApart({ answer: switchedSchema, opId }, (scope) => {
    const held = accessOf(scope.storage);
    if (held !== null) {
      scope.storage.run("DELETE FROM agent_vault", []);
      leftovers = { grantId: held.grantId, vaultId: held.vaultId };
      queueTeardown(scope.storage, leftovers, scope.now + TEARDOWN_AGAIN_MS);
    }
    return { enabled: false };
  });
  await runTeardown(cell, leftovers);
  return off;
};

export const agentEnabled = (library: LibraryEngine): CellResult<boolean> =>
  library.read((sql) => accessOf(sql)?.kind === "on");

// ---- repairing its credential ----

// what a repair found: the agent off (nothing to repair), the credential sound, a new grant in
// it, no verdict yet (ask again later), or no key to ask with
export type AgentRepair = "off" | "valid" | "repaired" | "later" | "unavailable";

// Anthropic could not use the credential: its own probe judges it
// (platform.claude.com/docs/en/managed-agents/vaults#diagnose-an-oauth-refresh-failure), and only
// a credential it judges invalid is given a new grant, which revokes the one before it
const repairAccess = async (cell: AgentCell): Promise<AgentRepair> => {
  const held = cell.library.read(accessOf);
  if (!held.ok || held.value?.kind !== "on") {
    return "off";
  }
  if (cell.agents === null) {
    return "unavailable";
  }
  const access = held.value;
  const { credentials } = cell.agents.client.beta.vaults;
  try {
    const checked = await credentials.mcpOAuthValidate(access.credentialId, {
      vault_id: access.vaultId,
    });
    if (checked.status !== "invalid") {
      return checked.status === "valid" ? "valid" : "later";
    }
    const grant = await grantBuiltInAgent(connectorAuth(cell.env), cell.env, {
      accountId: cell.accountId,
      endpoint: cell.endpoint,
    });
    // turned off while the grant was made: the new grant goes, and nothing holds it
    const swapped = inTransaction(cell.library, (scope) => {
      const current = accessOf(scope.storage);
      if (current?.kind !== "on" || current.credentialId !== access.credentialId) {
        refuse({ kind: "agent-unavailable" });
      }
      scope.storage.run("UPDATE agent_vault SET grant_id = ?", [grant.grantId]);
    });
    if (!swapped.ok) {
      await runTeardown(cell, { grantId: grant.grantId, vaultId: null });
      return "off";
    }
    await credentials.update(access.credentialId, {
      auth: {
        access_token: grant.accessToken,
        expires_at: grant.expiresAt,
        refresh: { refresh_token: grant.refreshToken },
        type: "mcp_oauth",
      },
      vault_id: access.vaultId,
    });
    return "repaired";
  } catch (error) {
    console.warn({ event: "agent-repair-failed", ...callFailureFields(error) });
    return "later";
  }
};

// what the cell does when Anthropic says the agent's credential failed (a session's
// `mcp_authentication_failed_error`, the `vault_credential.refresh_failed` webhook): a repair that
// reached no verdict is asked again by the alarm
export const repairAgentAccess = async (cell: AgentCell): Promise<AgentRepair> => {
  const repaired = await repairAccess(cell);
  if (repaired === "later") {
    inTransaction(cell.library, (scope) => {
      scheduleJob(scope.storage, REPAIR_JOB, scope.now + REPAIR_AGAIN_MS);
    });
  }
  return repaired;
};

// ---- the alarm's ----

const settledBy = async (cell: AgentCell, job: DueJob): Promise<boolean> => {
  if (job.kind === "agent-repair") {
    return (await repairAccess(cell)) !== "later";
  }
  try {
    await tearDown(cell, leftoversSchema.parse(JSON.parse(job.payload)));
    return true;
  } catch (error) {
    console.warn({ event: "agent-teardown-failed", ...callFailureFields(error) });
    return false;
  }
};

// the takedowns and repairs due, each dropped once done, else put off longer
export const runAgentJobs = async (cell: AgentCell): Promise<void> => {
  const due = cell.library.read((sql) =>
    dueJobs(sql, cell.now(), ["agent-teardown", "agent-repair"]),
  );
  if (!due.ok) {
    return;
  }
  for (const job of due.value) {
    const settled = await settledBy(cell, job);
    inTransaction(cell.library, (scope) => {
      if (settled) {
        dropJob(scope.storage, job.id);
      } else {
        retryJob(scope.storage, job, scope.now);
      }
    });
  }
};

// ---- the account's deletion ----

const sessionRowSchema = z.object({ session_id: z.string() });

const sessionIdsOf = (sql: SqlStatements): string[] =>
  sql
    .all(
      `SELECT session_id FROM threads WHERE session_id IS NOT NULL
       UNION SELECT session_id FROM agent_turn`,
      [],
    )
    .map((row) => sessionRowSchema.parse(row).session_id);

// the vault the row names and those a takedown still waits to delete
const vaultIdsOf = (sql: SqlStatements): string[] => {
  const held = accessOf(sql);
  const queued = waitingJobs(sql, "agent-teardown").map(
    (job) => leftoversSchema.parse(JSON.parse(job.payload)).vaultId,
  );
  return [...new Set([held?.vaultId ?? null, ...queued])].flatMap((id) => id ?? []);
};

const SETTLED = new Set(["idle", "terminated"]);

// a running session is interrupted and asked until it settles, since Anthropic refuses to delete
// one while it runs (platform.claude.com/docs/en/managed-agents/sessions); one already gone is done
const deleteSession = async (agents: ManagedAgents, sessionId: string): Promise<void> => {
  const { sessions } = agents.client.beta;
  try {
    let session = await sessions.retrieve(sessionId);
    if (!SETTLED.has(session.status)) {
      await sessions.events.send(sessionId, { events: [{ type: "user.interrupt" }] });
      for (let poll = 0; poll < SETTLE_POLLS && !SETTLED.has(session.status); poll += 1) {
        session = await sessions.retrieve(sessionId);
      }
    }
    await sessions.delete(sessionId);
  } catch (error) {
    if (!isGone(error)) {
      throw error;
    }
  }
};

// every session the account's threads hold and the agent's vault, deleted at Anthropic before the
// cell's rows, the only record of their ids, go; the grant goes with the account's others. Data
// held there with no key to delete it by aborts the deletion, which runs again once one is set
export const purgeAgentData = async (
  agents: ManagedAgents | null,
  sql: SqlStatements,
): Promise<void> => {
  const sessionIds = sessionIdsOf(sql);
  const vaultIds = vaultIdsOf(sql);
  if (sessionIds.length === 0 && vaultIds.length === 0) {
    return;
  }
  if (agents === null) {
    throw new Error("the account's conversations are Anthropic's to delete, and no key is set");
  }
  for (const sessionId of sessionIds) {
    await deleteSession(agents, sessionId);
  }
  for (const vaultId of vaultIds) {
    try {
      await agents.client.beta.vaults.delete(vaultId);
    } catch (error) {
      if (!isGone(error)) {
        throw error;
      }
    }
  }
};
