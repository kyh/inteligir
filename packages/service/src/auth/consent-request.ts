// What the consent page asks, read from the request the provider signed: one whose signature fails
// or that expired asks nothing, and the person starts again from their assistant.

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
      // its redirect is on this computer, which any app on it could have registered
      readonly loopback: boolean;
      readonly offlineAccess: boolean;
      // where access is sent, as a person can check it: a web redirect's host, or an app's scheme
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

export const readConsentRequest = async (query: string): Promise<ConsentRequest> => {
  const { secret } = await getAuth().$context;
  if (!(await verifyOAuthQueryParams(query, secret))) {
    return { kind: "refused", sentence: START_AGAIN };
  }
  const params = new URLSearchParams(query);
  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  if (clientId === null || redirectUri === null) {
    return { kind: "refused", sentence: START_AGAIN };
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
    return { kind: "refused", sentence: START_AGAIN };
  }
  const requested = (params.get("scope") ?? "").split(" ");
  const scopes = libraryScopesOf(requested);
  if (scopes.length === 0) {
    return {
      kind: "refused",
      sentence: "This assistant asked for nothing in your library, so there is nothing to allow.",
    };
  }
  return {
    assistant: assistantIdentity(client),
    kind: "ask",
    offlineAccess: requested.includes("offline_access"),
    scopes,
    ...redirectOf(redirectUri),
  };
};
