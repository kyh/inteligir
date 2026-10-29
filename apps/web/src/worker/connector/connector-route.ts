// `/connector` as the Worker answers it: a request whose Host or Origin is not this deployment's
// is refused first, since the MCP handler validates neither and Streamable HTTP requires an Origin
// check (modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http); then
// the provider's resource server challenges any call without a token minted for this connector,
// and publishes the metadata that challenge names. A call that passes is checked for the scope it
// needs and its grant's budget, then forwarded whole into the account's cell, carrying the
// principal the token verified and nothing the caller sent in its place. No device credential is
// taken here: the connector is an assistant's door alone.

import {
  hostHeaderValidationResponse,
  originValidationResponse,
} from "@modelcontextprotocol/server";
import { insufficientScope } from "@cloudflare/workers-oauth-provider";
import type { OAuthResourceHandler } from "@cloudflare/workers-oauth-provider";

import { createDb } from "../db/client";
import { libraryCell } from "../library/library-cell";
import {
  LIBRARY_SCOPES,
  PRINCIPAL_HEADER,
  principalHeaderValue,
} from "../library/library-principal";
import type { AssistantPrincipal } from "../library/library-principal";
import { spendDeviceBudget } from "../rate-limit";
import { connectorAuth, READ_SCOPE } from "./connector-auth";
import type { TokenProps } from "./connector-auth";

// what the cell is handed in place of what the caller sent
const FORWARD_DROPS = [PRINCIPAL_HEADER, "authorization", "cookie"] as const;

const isLibraryScope = (scope: string): scope is (typeof LIBRARY_SCOPES)[number] =>
  LIBRARY_SCOPES.some((known) => known === scope);

// a grant's budget spent: what a client backs off by, in OAuth's error shape
const tooManyCalls = (): Response =>
  Response.json(
    { error: "too_many_requests", error_description: "Too many requests. Try again in a minute." },
    { headers: { "retry-after": "60" }, status: 429 },
  );

const forwardToCell: OAuthResourceHandler<Env, TokenProps> = {
  async fetch(request, env, ctx) {
    const { auth, props } = ctx;
    const scopes = auth.scope.filter(isLibraryScope);
    // `library` implies reading, so either scope admits a call; one with neither steps up
    if (scopes.length === 0) {
      return insufficientScope(auth, [READ_SCOPE]);
    }
    // the provider's own token record names its client, so a token without one is not its own
    if (auth.clientId === undefined) {
      throw new Error("a token the authorization server minted names its client");
    }
    if (!(await spendDeviceBudget(env, createDb(env.DB), "connector", props.grantId))) {
      return tooManyCalls();
    }
    const principal: AssistantPrincipal = {
      accountId: props.accountId,
      actor: {
        clientId: auth.clientId,
        clientName: props.clientName,
        grantId: props.grantId,
        kind: "assistant",
      },
      scopes,
    };
    const headers = new Headers(request.headers);
    for (const name of FORWARD_DROPS) {
      headers.delete(name);
    }
    headers.set(PRINCIPAL_HEADER, principalHeaderValue(principal));
    return await libraryCell(ctx.exports, principal.accountId).fetch(
      new Request(request, { headers }),
    );
  },
};

export const handleConnector = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> => {
  const auth = connectorAuth(env);
  const { hostname } = new URL(auth.origin);
  const refused =
    hostHeaderValidationResponse(request, [hostname]) ??
    originValidationResponse(request, [hostname]);
  return refused ?? (await auth.resourceServer(forwardToCell).fetch(request, env, ctx));
};
