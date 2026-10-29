// The built-in agent's access to the account's library, which the person switches on and off
// (`library.agent.setEnabled`). While it is on the account holds one grant of the built-in OAuth
// client (`./built-in-client`) and one Managed Agents vault holding one `mcp_oauth` credential for
// the connector, which every session the cell starts names, so Anthropic's proxy adds the token to
// each of the agent's calls and refreshes it at this Worker's token endpoint
// (platform.claude.com/docs/en/managed-agents/vaults). The `agent_vault` row is the switch. A
// turn-on claims it, writes each id onto it as its call returns, and reads it again after every call
// that leaves the cell, since other calls land meanwhile (a turn-off, a second turn-on, the
// account's deletion); one that finds the row no longer its own takes down what it made, and one
// the platform ended part way is let go of by its job once its hold runs out. A grant is made only
// under a hold on the row, a turn-on's claim or a repair's lease, and revokes no other as it is
// made, which could revoke one another call just made: a repair revokes the grant it replaced once
// the row names the new one, and the grants a failed call left, which no row names, go before the
// next is made and once the agent is off. Turning it off deletes the row and takes the grant and
// the vault down at once, a job retrying until both are gone, and nothing but the person turns it
// on again: a repair of a credential that is off finds nothing to repair, so no failure re-grants
// it.

import { z } from "zod";

import type { SqlStatements } from "@repo/notes/library/library-sql";

import { agentGrantIds } from "../connector/assistant-grants";
import { connectorAuth } from "../connector/connector-auth";
import type { Built, LibraryEngine, WriteRequest } from "../library/library-engine";
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
  // the cell's alarm set to its earliest job, so a job one of these calls queued runs even when the
  // platform ends the call before its caller would set it
  readonly scheduleAlarm: () => Promise<void>;
}

const switchedSchema = z.object({ enabled: z.boolean() });

type Switched = z.infer<typeof switchedSchema>;

// what the vault and its credential are called in Anthropic's console
const VAULT_NAME = "Inteligir library";

// a hold on the row, a turn-on's claim or a repair's lease: past it, an attempt the platform ended
// part way is taken over. It outlasts a whole attempt, the grant made in process and two calls to
// Anthropic, each at most 30 seconds and sent once
const LEASE_MS = 2 * 60_000;

// a call to Anthropic sent once: a create, which a retry after a lost answer would make twice, and
// each call of a repair, which its lease bounds and its job asks again
const SEND_ONCE = { maxRetries: 0 } as const;

// a takedown a call runs at once is asked again this long after, if it did not finish
const TEARDOWN_AGAIN_MS = 60_000;

// a credential whose verdict Anthropic could not reach is checked again after this
const REPAIR_AGAIN_MS = 5 * 60_000;

// an interrupted session settles a moment later, and is asked this many times before its deletion
const SETTLE_POLLS = 10;

const REPAIR_JOB = { id: "agent-repair", kind: "agent-repair", payload: "{}" } as const;

const UNAVAILABLE = { ok: false, refusal: { kind: "agent-unavailable" } } as const;

const LANDED = z.literal(true);

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
      // when the repair holding the row leased it, null while none does
      readonly repairStartedAt: number | null;
    };

const accessRowSchema = z.object({
  credential_id: z.string().nullable(),
  grant_id: z.string().nullable(),
  repair_started_at: z.number().int().nullable(),
  started_at: z.number().int(),
  vault_id: z.string().nullable(),
});

const accessOf = (sql: SqlStatements): Access | null => {
  const [raw] = sql.all(
    "SELECT started_at, grant_id, vault_id, credential_id, repair_started_at FROM agent_vault",
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
        repairStartedAt: row.repair_started_at,
        startedAt: row.started_at,
        vaultId: row.vault_id,
      }
    : { grantId: row.grant_id, kind: "starting", startedAt: row.started_at, vaultId: row.vault_id };
};

// the row a turn-on claimed at `startedAt`, still its own: neither turned off nor taken over
const claimedBy = (held: Access | null, startedAt: number): boolean =>
  held?.kind === "starting" && held.startedAt === startedAt;

const ownedBy = (sql: SqlStatements, startedAt: number): boolean =>
  claimedBy(accessOf(sql), startedAt);

// one transaction of the agent's, then the alarm set to the jobs it queued
const landAgent = async <S extends z.ZodType>(
  cell: AgentCell,
  request: WriteRequest<S>,
  work: (scope: LandingScope) => Built<z.input<S>>,
): Promise<CellResult<z.output<S>>> => {
  const landed = cell.library.landApart(request, work);
  await cell.scheduleAlarm();
  return landed;
};

// one that answers nothing but that it landed
const inTransaction = async (
  cell: AgentCell,
  work: (scope: LandingScope) => void,
): Promise<CellResult<true>> =>
  await landAgent(cell, { answer: LANDED, opId: undefined }, (scope) => {
    work(scope);
    return true as const;
  });

// ---- taking it down ----

// what a grant and a vault left to take down name; either may be missing
const leftoversSchema = z.object({
  grantId: z.string().nullable(),
  vaultId: z.string().nullable(),
});

type Leftovers = z.infer<typeof leftoversSchema>;

const NOTHING: Leftovers = { grantId: null, vaultId: null };

const leftoversOf = (held: Access): Leftovers => ({ grantId: held.grantId, vaultId: held.vaultId });

const teardownJobId = (leftovers: Leftovers): string =>
  `agent-teardown:${leftovers.grantId ?? ""}:${leftovers.vaultId ?? ""}`;

// a takedown asked for in the transaction that lets its ids go, so one the platform cuts short is
// run again by the alarm
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
  await inTransaction(cell, (scope) => {
    dropJob(scope.storage, teardownJobId(leftovers));
  });
};

// the agent's grants no row names, revoked: those a grant made by a call the platform ended, or
// whose next step failed, left on the account. Only while `holds` still holds once they are listed:
// a call that will keep the grant it makes holds the row from before it makes one (a turn-on's
// claim, a repair's lease), so a grant listed is one no later hold made, and one whose call lost its
// hold meanwhile is let go of by that call anyway
const revokeStrayGrants = async (
  cell: AgentCell,
  holds: (held: Access | null) => boolean,
): Promise<void> => {
  const { helpers } = connectorAuth(cell.env);
  const listed = await agentGrantIds(helpers, cell.accountId);
  const held = cell.library.read(accessOf);
  if (!held.ok || !holds(held.value)) {
    return;
  }
  const named = held.value?.grantId ?? null;
  for (const grantId of listed) {
    if (grantId !== named) {
      await helpers.revokeGrant(grantId, cell.accountId);
    }
  }
};

// what the agent turned off, or a turn-on let go of, leaves: what the row named, taken down now (its
// job asks again what fails), and every grant of the agent's a failed call left, while it is off
const takeDownWhileOff = async (cell: AgentCell, leftovers: Leftovers): Promise<void> => {
  await runTeardown(cell, leftovers);
  try {
    await revokeStrayGrants(cell, (held) => held === null);
  } catch (error) {
    console.warn({ event: "agent-stray-grants-failed", ...callFailureFields(error) });
  }
};

// ---- turning it on ----

// a turn-on's own job, asked for as it claims the row and dropped as it lands or lets go: one the
// platform ended part way leaves the row claimed, which the job lets go of once the hold runs out
const startJob = (startedAt: number) =>
  ({
    id: `agent-start:${String(startedAt)}`,
    kind: "agent-start",
    payload: JSON.stringify({ startedAt }),
  }) as const;

const startJobSchema = z.object({ startedAt: z.number().int() });

// what a turn-on made, let go of: its row, while still its own, and the grant and vault it made,
// taken down at once. A deleted account refuses the queue, and the takedown is tried all the same
const abandon = async (
  cell: AgentCell,
  startedAt: number,
  made: Leftovers,
): Promise<CellResult<never>> => {
  const released = await inTransaction(cell, (scope) => {
    if (ownedBy(scope.storage, startedAt)) {
      scope.storage.run("DELETE FROM agent_vault", []);
      dropJob(scope.storage, startJob(startedAt).id);
    }
    queueTeardown(scope.storage, made, scope.now + TEARDOWN_AGAIN_MS);
  });
  await takeDownWhileOff(cell, made);
  return released.ok ? UNAVAILABLE : released;
};

type Claim =
  | { readonly kind: "on" }
  | { readonly kind: "busy" }
  | { readonly kind: "claimed"; readonly startedAt: number };

const claimSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("on") }),
  z.object({ kind: z.literal("busy") }),
  z.object({ kind: z.literal("claimed"), startedAt: z.number() }),
]);

// the row, claimed for a turn-on, with the job that lets it go if this call never ends; one an
// attempt left past its hold is taken over, what it made queued for its takedown
const claim = (scope: LandingScope, accountId: string): Claim => {
  const held = accessOf(scope.storage);
  if (held?.kind === "on") {
    return { kind: "on" };
  }
  if (held !== null && scope.now - held.startedAt < LEASE_MS) {
    return { kind: "busy" };
  }
  if (held !== null) {
    queueTeardown(scope.storage, leftoversOf(held), scope.now);
    dropJob(scope.storage, startJob(held.startedAt).id);
  }
  scope.storage.run(
    `INSERT INTO agent_vault (account_id, started_at) VALUES (?, ?)
     ON CONFLICT (account_id) DO UPDATE SET started_at = excluded.started_at, grant_id = NULL,
       vault_id = NULL, credential_id = NULL, repair_started_at = NULL`,
    [accountId, scope.now],
  );
  scheduleJob(scope.storage, startJob(scope.now), scope.now + LEASE_MS);
  return { kind: "claimed", startedAt: scope.now };
};

// one id a call returned, written onto the row while it is still this turn-on's
const recordOn = (
  cell: AgentCell,
  startedAt: number,
  column: "grant_id" | "vault_id",
  id: string,
): CellResult<true> =>
  cell.library.landApart({ answer: LANDED, opId: undefined }, (scope) => {
    if (!ownedBy(scope.storage, startedAt)) {
      refuse({ kind: "agent-unavailable" });
    }
    scope.storage.run(`UPDATE agent_vault SET ${column} = ?`, [id]);
    return true as const;
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

const grantFor = async (cell: AgentCell): Promise<BuiltInGrant> =>
  await grantBuiltInAgent(connectorAuth(cell.env), cell.env, {
    accountId: cell.accountId,
    endpoint: cell.endpoint,
  });

// the grant, then the vault, then its credential, each id on the row as it comes, the grants an
// earlier attempt left revoked first
const provision = async (
  cell: AgentCell,
  agents: ManagedAgents,
  startedAt: number,
  opId: string | undefined,
): Promise<CellResult<Switched>> => {
  let made = NOTHING;
  try {
    await revokeStrayGrants(cell, (held) => claimedBy(held, startedAt));
    const grant = await grantFor(cell);
    made = { ...made, grantId: grant.grantId };
    if (!recordOn(cell, startedAt, "grant_id", grant.grantId).ok) {
      return await abandon(cell, startedAt, made);
    }
    const vault = await agents.client.beta.vaults.create(
      { display_name: VAULT_NAME, metadata: { account_id: cell.accountId } },
      SEND_ONCE,
    );
    made = { ...made, vaultId: vault.id };
    if (!recordOn(cell, startedAt, "vault_id", vault.id).ok) {
      return await abandon(cell, startedAt, made);
    }
    const credential = await agents.client.beta.vaults.credentials.create(
      vault.id,
      { auth: credentialAuth(grant), display_name: VAULT_NAME },
      SEND_ONCE,
    );
    const on = await landAgent(cell, { answer: switchedSchema, opId }, (scope) => {
      if (!ownedBy(scope.storage, startedAt)) {
        refuse({ kind: "agent-unavailable" });
      }
      scope.storage.run("UPDATE agent_vault SET credential_id = ?", [credential.id]);
      dropJob(scope.storage, startJob(startedAt).id);
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
  const claimed = await landAgent(cell, { answer: claimSchema, opId: undefined }, (scope) =>
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
  const off = await landAgent(cell, { answer: switchedSchema, opId }, (scope) => {
    const held = accessOf(scope.storage);
    if (held !== null) {
      scope.storage.run("DELETE FROM agent_vault", []);
      // a turn-on still under way finds its row gone and takes down what it made
      dropJob(scope.storage, startJob(held.startedAt).id);
      leftovers = leftoversOf(held);
      queueTeardown(scope.storage, leftovers, scope.now + TEARDOWN_AGAIN_MS);
    }
    return { enabled: false };
  });
  if (off.ok) {
    await takeDownWhileOff(cell, leftovers);
  }
  return off;
};

export const agentEnabled = (library: LibraryEngine): CellResult<boolean> =>
  library.read((sql) => accessOf(sql)?.kind === "on");

// ---- repairing its credential ----

// what a repair found: the agent off (nothing to repair), the credential sound, a new grant in
// it, no verdict yet (ask again later, as when another repair is under way), or no key to ask with
export type AgentRepair = "off" | "valid" | "repaired" | "later" | "unavailable";

const leaseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("off") }),
  z.object({ kind: z.literal("busy") }),
  z.object({
    credentialId: z.string(),
    grantId: z.string(),
    kind: z.literal("leased"),
    leasedAt: z.number(),
    vaultId: z.string(),
  }),
]);

type Leased = Extract<z.infer<typeof leaseSchema>, { kind: "leased" }>;

// the row, leased for one repair while the agent is on, so two never make a grant each and hand
// Anthropic the one the other revoked; a lease a repair the platform ended left is taken over once
// it runs out
const leaseRepair = (scope: LandingScope): z.input<typeof leaseSchema> => {
  const held = accessOf(scope.storage);
  if (held?.kind !== "on") {
    return { kind: "off" };
  }
  if (held.repairStartedAt !== null && scope.now - held.repairStartedAt < LEASE_MS) {
    return { kind: "busy" };
  }
  scope.storage.run("UPDATE agent_vault SET repair_started_at = ?", [scope.now]);
  return {
    credentialId: held.credentialId,
    grantId: held.grantId,
    kind: "leased",
    leasedAt: scope.now,
    vaultId: held.vaultId,
  };
};

// the row as the repair that leased it at `leasedAt` left it: on, and still under its lease
const leasedBy = (held: Access | null, leasedAt: number): boolean =>
  held?.kind === "on" && held.repairStartedAt === leasedAt;

const swapSchema = z.enum(["swapped", "lost", "off"]);

// the new grant onto the row before Anthropic is handed it, the one it replaces queued to go, so
// the row names the grant to revoke whatever happens next; one whose lease ran out or went with the
// row queues its own new grant to go instead
const swapGrant = (scope: LandingScope, leased: Leased, grantId: string) => {
  const held = accessOf(scope.storage);
  if (!leasedBy(held, leased.leasedAt) || scope.now - leased.leasedAt >= LEASE_MS) {
    queueTeardown(scope.storage, { grantId, vaultId: null }, scope.now);
    return held?.kind === "on" ? "lost" : "off";
  }
  scope.storage.run("UPDATE agent_vault SET grant_id = ?", [grantId]);
  queueTeardown(
    scope.storage,
    { grantId: leased.grantId, vaultId: null },
    scope.now + TEARDOWN_AGAIN_MS,
  );
  return "swapped";
};

// Anthropic's own probe judges the credential
// (platform.claude.com/docs/en/managed-agents/vaults#diagnose-an-oauth-refresh-failure), and only
// one it judges invalid is given a new grant: the grants a failed repair left revoked first, the
// grant made, swapped onto the row, handed to the credential, and only then the one it replaced
// revoked
const mend = async (
  cell: AgentCell,
  agents: ManagedAgents,
  leased: Leased,
): Promise<AgentRepair> => {
  const { credentials } = agents.client.beta.vaults;
  const checked = await credentials.mcpOAuthValidate(
    leased.credentialId,
    { vault_id: leased.vaultId },
    SEND_ONCE,
  );
  if (checked.status !== "invalid") {
    return checked.status === "valid" ? "valid" : "later";
  }
  await revokeStrayGrants(cell, (held) => leasedBy(held, leased.leasedAt));
  const grant = await grantFor(cell);
  const swapped = await landAgent(cell, { answer: swapSchema, opId: undefined }, (scope) =>
    swapGrant(scope, leased, grant.grantId),
  );
  if (!swapped.ok || swapped.value !== "swapped") {
    await runTeardown(cell, { grantId: grant.grantId, vaultId: null });
    return swapped.ok && swapped.value === "lost" ? "later" : "off";
  }
  await credentials.update(
    leased.credentialId,
    {
      auth: {
        access_token: grant.accessToken,
        expires_at: grant.expiresAt,
        refresh: { refresh_token: grant.refreshToken },
        type: "mcp_oauth",
      },
      vault_id: leased.vaultId,
    },
    SEND_ONCE,
  );
  await runTeardown(cell, { grantId: leased.grantId, vaultId: null });
  return "repaired";
};

// Anthropic could not use the credential: a repair, under the row's lease, which it gives back
// however it ends
const repairAccess = async (cell: AgentCell): Promise<AgentRepair> => {
  const held = cell.library.read(accessOf);
  if (!held.ok || held.value?.kind !== "on") {
    return "off";
  }
  if (cell.agents === null) {
    return "unavailable";
  }
  const lease = await landAgent(cell, { answer: leaseSchema, opId: undefined }, leaseRepair);
  if (!lease.ok || lease.value.kind === "off") {
    return "off";
  }
  // the repair under way reaches the verdict, and this asks again after it
  if (lease.value.kind === "busy") {
    return "later";
  }
  const leased = lease.value;
  try {
    return await mend(cell, cell.agents, leased);
  } catch (error) {
    console.warn({ event: "agent-repair-failed", ...callFailureFields(error) });
    return "later";
  } finally {
    cell.library.landApart({ answer: LANDED, opId: undefined }, (scope) => {
      scope.storage.run(
        "UPDATE agent_vault SET repair_started_at = NULL WHERE repair_started_at = ?",
        [leased.leasedAt],
      );
      return true as const;
    });
  }
};

// what the cell does when Anthropic says the agent's credential failed (a session's
// `mcp_authentication_failed_error`, the `vault_credential.refresh_failed` webhook): a repair that
// reached no verdict is asked again by the alarm
export const repairAgentAccess = async (cell: AgentCell): Promise<AgentRepair> => {
  const repaired = await repairAccess(cell);
  if (repaired === "later") {
    await inTransaction(cell, (scope) => {
      scheduleJob(scope.storage, REPAIR_JOB, scope.now + REPAIR_AGAIN_MS);
    });
  }
  return repaired;
};

// ---- the alarm's ----

// a turn-on the platform ended part way, let go of once its hold ran out: its row, unless a
// turn-off or a later turn-on took it meanwhile, and what the row names
const letGo = async (cell: AgentCell, job: DueJob): Promise<void> => {
  const { startedAt } = startJobSchema.parse(JSON.parse(job.payload));
  let leftovers = NOTHING;
  await inTransaction(cell, (scope) => {
    const held = accessOf(scope.storage);
    if (held !== null && claimedBy(held, startedAt)) {
      scope.storage.run("DELETE FROM agent_vault", []);
      leftovers = leftoversOf(held);
      queueTeardown(scope.storage, leftovers, scope.now + TEARDOWN_AGAIN_MS);
    }
  });
  await takeDownWhileOff(cell, leftovers);
};

const AGENT_JOBS = ["agent-teardown", "agent-repair", "agent-start"] as const;

const settledBy = async (
  cell: AgentCell,
  job: DueJob<(typeof AGENT_JOBS)[number]>,
): Promise<boolean> => {
  switch (job.kind) {
    case "agent-repair": {
      return (await repairAccess(cell)) !== "later";
    }
    case "agent-start": {
      await letGo(cell, job);
      return true;
    }
    case "agent-teardown": {
      try {
        await tearDown(cell, leftoversSchema.parse(JSON.parse(job.payload)));
        return true;
      } catch (error) {
        console.warn({ event: "agent-teardown-failed", ...callFailureFields(error) });
        return false;
      }
    }
    // no default
  }
};

// the takedowns, repairs and unfinished turn-ons due, each dropped once done, else put off longer
export const runAgentJobs = async (cell: AgentCell): Promise<void> => {
  const due = cell.library.read((sql) => dueJobs(sql, cell.now(), AGENT_JOBS));
  if (!due.ok) {
    return;
  }
  for (const job of due.value) {
    const settled = await settledBy(cell, job);
    await inTransaction(cell, (scope) => {
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
