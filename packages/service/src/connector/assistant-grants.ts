// The assistants a person let into their library: each one grant of the connector's consent page,
// held by the OAuth provider in KV and read through its helpers (`listUserGrants`, `revokeGrant`),
// for `account.assistants.list` and `account.assistants.revoke`, and the account's deletion, which
// revokes every grant. A person's revoke is decided by its row in D1 (`./revoked-grants`), which
// ends the assistant's access at once wherever KV has yet to settle; a deletion needs none, since
// the cell's tombstone refuses every call.

import type { GrantSummary, OAuthHelpers } from "@cloudflare/workers-oauth-provider";

import type { Db } from "@repo/db/d1/client";
import { grantMetadataSchema } from "./connector-auth";
import type { GrantMetadata } from "./connector-auth";
import { markGrantRevoked, revokedGrantIds } from "./revoked-grants";

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
// the grant kept none), and the time in ms, as every row the wire answers keeps it
const assistantOf = (grant: GrantSummary): Assistant => ({
  clientName: keptOf(grant)?.clientName ?? grant.clientId,
  createdAt: grant.createdAt * 1000,
  grantId: grant.id,
  scopes: [...grant.scope],
});

// who can reach the library, so not a grant a racing refresh wrote back after its revoke
export const listAssistants = async (
  helpers: OAuthHelpers,
  db: Db,
  accountId: string,
): Promise<Assistant[]> => {
  const [grants, revoked] = await Promise.all([
    grantsOf(helpers, accountId),
    revokedGrantIds(db, accountId),
  ]);
  return grants.filter((grant) => !revoked.has(grant.id)).map(assistantOf);
};

// one of the account's assistants revoked, its tokens with it; false when the account lets in no
// such assistant, since a grant id names one account's only. The row goes first, so a refresh past
// its check when the grant goes mints a token no call takes
export const revokeAssistant = async (
  helpers: OAuthHelpers,
  db: Db,
  accountId: string,
  grantId: string,
): Promise<boolean> => {
  const assistants = await listAssistants(helpers, db, accountId);
  if (!assistants.some((assistant) => assistant.grantId === grantId)) {
    return false;
  }
  await markGrantRevoked(db, { accountId, grantId });
  await helpers.revokeGrant(grantId, accountId);
  return true;
};

// every grant the account holds, as its deletion revokes them
export const revokeEveryGrant = async (helpers: OAuthHelpers, accountId: string): Promise<void> => {
  for (const grant of await grantsOf(helpers, accountId)) {
    await helpers.revokeGrant(grant.id, accountId);
  }
};
