// The assistants a person let into their library: each one grant of the connector's consent page,
// held by the OAuth provider in KV and read through its helpers (`listUserGrants`, `revokeGrant`),
// for `account.assistants.list` and `account.assistants.revoke`, and the account's deletion, which
// revokes every grant. The built-in agent's grant is the provider's too, but it is no assistant's:
// its own switch makes and revokes it with the vault that holds it (`../agent/agent-access`), so
// the list leaves it out and a revoke here never reaches it. KV settles across locations within
// about a minute, so a revoked grant's token may still be answered elsewhere for that long.

import type { GrantSummary, OAuthHelpers } from "@cloudflare/workers-oauth-provider";

import { grantMetadataSchema } from "./connector-auth";
import type { GrantMetadata } from "./connector-auth";

// a listing's page, at the most the provider answers in one
const GRANT_PAGE = 1000;

export interface Assistant {
  readonly clientName: string;
  readonly createdAt: number;
  readonly grantId: string;
  readonly scopes: string[];
}

const grantsOf = async (
  helpers: OAuthHelpers,
  accountId: string,
): Promise<readonly GrantSummary[]> => {
  const grants: GrantSummary[] = [];
  let cursor: string | undefined;
  do {
    const page = await helpers.listUserGrants(
      accountId,
      cursor === undefined ? { limit: GRANT_PAGE } : { cursor, limit: GRANT_PAGE },
    );
    grants.push(...page.items);
    ({ cursor } = page);
  } while (cursor !== undefined);
  return grants;
};

// what the grant was made with, null for one that kept none of this Worker's shape
const keptOf = (grant: GrantSummary): GrantMetadata | null => {
  const metadata = grantMetadataSchema.safeParse(grant.metadata);
  return metadata.success ? metadata.data : null;
};

// a grant as the account's list shows it: the name the client gave when it was let in (its id when
// the grant kept none), and the time in ms, as every row the wire answers keeps it; null for the
// built-in agent's
const assistantOf = (grant: GrantSummary): Assistant | null => {
  const kept = keptOf(grant);
  if (kept?.kind === "agent") {
    return null;
  }
  return {
    clientName: kept?.clientName ?? grant.clientId,
    createdAt: grant.createdAt * 1000,
    grantId: grant.id,
    scopes: [...grant.scope],
  };
};

export const listAssistants = async (
  helpers: OAuthHelpers,
  accountId: string,
): Promise<Assistant[]> => {
  const grants = await grantsOf(helpers, accountId);
  return grants.flatMap((grant) => assistantOf(grant) ?? []);
};

// one of the account's assistants revoked, its tokens with it; false when the account lets in no
// such assistant, since a grant id names one account's only
export const revokeAssistant = async (
  helpers: OAuthHelpers,
  accountId: string,
  grantId: string,
): Promise<boolean> => {
  const assistants = await listAssistants(helpers, accountId);
  if (!assistants.some((assistant) => assistant.grantId === grantId)) {
    return false;
  }
  await helpers.revokeGrant(grantId, accountId);
  return true;
};

// the built-in agent's grants on the account, by id: its one while it is on, and any a grant made
// by a call that then failed or was ended left beside it
export const agentGrantIds = async (
  helpers: OAuthHelpers,
  accountId: string,
): Promise<string[]> => {
  const grants = await grantsOf(helpers, accountId);
  return grants.flatMap((grant) => (keptOf(grant)?.kind === "agent" ? [grant.id] : []));
};

// every grant the account holds, the built-in agent's with its assistants', as its deletion
// revokes them
export const revokeEveryGrant = async (helpers: OAuthHelpers, accountId: string): Promise<void> => {
  for (const grant of await grantsOf(helpers, accountId)) {
    await helpers.revokeGrant(grant.id, accountId);
  }
};
