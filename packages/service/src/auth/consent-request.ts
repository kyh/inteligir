import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { oauthClient } from "@repo/db/auth-schema";
import { db } from "@repo/db/drizzle-client";
import { eq } from "drizzle-orm";

import type { LibraryScope } from "../library/library-principal";
import { getAuth } from "./auth";
import { assistantIdentity, libraryScopesOf } from "./oauth-auth";
import type { AssistantIdentity } from "./oauth-auth";

export type ConsentRequest =
  | {
      readonly kind: "ask";
      readonly assistant: AssistantIdentity;
      readonly loopback: boolean;
      readonly offlineAccess: boolean;
      readonly redirectTo: string;
      readonly scopes: readonly LibraryScope[];
    }
  | { readonly kind: "refused"; readonly sentence: string };

const START_AGAIN = "This link expired. Start connecting again from your assistant.";

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

const redirectOf = (redirectUri: string) => {
  const url = URL.parse(redirectUri);

  if (url === null) {
    return { loopback: false, redirectTo: redirectUri };
  }

  const web = url.protocol === "http:" || url.protocol === "https:";

  return {
    loopback: web && LOOPBACK_HOSTS.has(url.hostname),
    redirectTo: web ? url.host : `${url.protocol}//${url.host}`,
  };
};

export const readConsentRequest = async (query: string) => {
  const { secret } = await getAuth().$context;

  if (!(await verifyOAuthQueryParams(query, secret))) {
    return { kind: "refused", sentence: START_AGAIN } satisfies ConsentRequest;
  }

  const params = new URLSearchParams(query);
  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");

  if (clientId === null || redirectUri === null) {
    return { kind: "refused", sentence: START_AGAIN } satisfies ConsentRequest;
  }

  const [client] = await db
    .select({
      clientDiscoveryId: oauthClient.clientDiscoveryId,
      clientId: oauthClient.clientId,
      disabled: oauthClient.disabled,
      name: oauthClient.name,
    })
    .from(oauthClient)
    .where(eq(oauthClient.clientId, clientId))
    .limit(1);

  if (client === undefined || client.disabled === true) {
    return { kind: "refused", sentence: START_AGAIN } satisfies ConsentRequest;
  }

  const requested = (params.get("scope") ?? "").split(" ");
  const scopes = libraryScopesOf(requested);

  if (scopes.length === 0) {
    return {
      kind: "refused",
      sentence: "This assistant asked for nothing in your library, so there is nothing to allow.",
    } satisfies ConsentRequest;
  }

  return {
    assistant: assistantIdentity(client),
    kind: "ask",
    offlineAccess: requested.includes("offline_access"),
    scopes,
    ...redirectOf(redirectUri),
  } satisfies ConsentRequest;
};
