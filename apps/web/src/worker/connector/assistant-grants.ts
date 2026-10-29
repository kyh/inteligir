// The assistants a person let into their library: each one grant of the connector's consent page,
// held by the OAuth provider in KV and read through its helpers (`listUserGrants`, `revokeGrant`),
// for the account's list in Settings, a revoke from there, and the account's deletion, which
// revokes every one. KV settles across locations within about a minute, so a revoked grant's
// token may still be answered elsewhere for that long.

import type { GrantSummary, OAuthHelpers } from "@cloudflare/workers-oauth-provider";

import { grantMetadataSchema } from "./connector-auth";

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

// a grant as the account's list shows it: the name the client gave when it was let in (its id when
// the grant kept none), and the time in ms, as every row the wire answers keeps it
const assistantOf = (grant: GrantSummary): Assistant => {
  const metadata = grantMetadataSchema.safeParse(grant.metadata);
  return {
    clientName: metadata.success ? metadata.data.clientName : grant.clientId,
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
  return grants.map(assistantOf);
};

// one of the account's grants revoked, its tokens with it; false when the account holds no such
// grant, since a grant id names one account's only
export const revokeAssistant = async (
  helpers: OAuthHelpers,
  accountId: string,
  grantId: string,
): Promise<boolean> => {
  const grants = await grantsOf(helpers, accountId);
  if (!grants.some((grant) => grant.id === grantId)) {
    return false;
  }
  await helpers.revokeGrant(grantId, accountId);
  return true;
};

// every grant the account holds, as its deletion revokes them
export const revokeEveryAssistant = async (
  helpers: OAuthHelpers,
  accountId: string,
): Promise<void> => {
  for (const grant of await grantsOf(helpers, accountId)) {
    await helpers.revokeGrant(grant.id, accountId);
  }
};
