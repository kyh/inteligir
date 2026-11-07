// Who a call to the library is by: the account, what it may do, and the actor whose change set its
// writes join. The Worker resolves it from the credential the request carried (a device's bearer
// and a browser's session on `/v1`, an assistant's OAuth token on the connector), drops any copy
// the request brought, and stamps it on the request it forwards to the account's cell
// (`../wire/v1-rpc`, `../connector/connector-route`); the cell takes it from there alone, since
// only the Worker reaches a cell, and holds it to the account its own name gives. The built-in
// agent's principal is never a header's: the cell mints it in `agentTool`, for one turn of one
// thread, and its writes are refused once that turn is no longer open. Procedures read the actor
// a principal resolves to, never a header.

import { z } from "zod";

import type { CellActor } from "./cell-actor";
import { libraryCell } from "./library-cell";

export const PRINCIPAL_HEADER = "x-library-principal";
export const SOCKET_HOLDER_HEADER = "x-library-socket-holder";

// what a credential may do with the library: `library` reads and changes it, and `library:read`,
// which only an assistant's grant can hold, reads it alone
export const LIBRARY_SCOPES = ["library", "library:read"] as const;

// the id a credential goes by: a device's, a browser session's or an assistant's grant
export const credentialIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);

// an app signed in on a device: the Mac, the phone, the extension
const deviceActorSchema = z.strictObject({
  deviceId: credentialIdSchema,
  deviceName: z.string().min(1).max(128),
  kind: z.literal("device"),
});

// the library in a browser tab, signed in with the site's own session
const sessionActorSchema = z.strictObject({
  kind: z.literal("session"),
  sessionId: credentialIdSchema,
});

// the person's own assistant under one grant of the connector's consent page; its client id is a
// URL for a client that publishes its metadata, and its name is the client's own claim
const assistantActorSchema = z.strictObject({
  clientId: z.string().min(1).max(2048),
  clientName: z.string().min(1).max(128),
  grantId: credentialIdSchema,
  kind: z.literal("assistant"),
});

// what a header may carry: every principal but the built-in agent's, so no request names one
export const principalSchema = z.strictObject({
  accountId: z.string().min(1).max(128),
  actor: z.discriminatedUnion("kind", [
    deviceActorSchema,
    sessionActorSchema,
    assistantActorSchema,
  ]),
  scopes: z.array(z.enum(LIBRARY_SCOPES)).min(1),
});

// a principal its own claim names, as the Worker stamps it
export type NamedPrincipal = z.infer<typeof principalSchema>;

// the built-in agent in one turn of one thread, which only the cell names
export interface AgentPrincipal {
  readonly accountId: string;
  readonly actor: { readonly kind: "agent"; readonly threadId: string; readonly turn: number };
  readonly scopes: readonly ["library"];
}

export type Principal = NamedPrincipal | AgentPrincipal;

export const agentPrincipal = (
  accountId: string,
  turn: { readonly threadId: string; readonly turn: number },
): AgentPrincipal => ({
  accountId,
  actor: { kind: "agent", threadId: turn.threadId, turn: turn.turn },
  scopes: ["library"],
});

// what an app's credential verifies to on `/v1`, which takes no assistant
export type AppPrincipal = NamedPrincipal & {
  readonly actor: z.infer<typeof deviceActorSchema> | z.infer<typeof sessionActorSchema>;
};

// what the connector takes: an assistant's grant, the person's own Claude or ChatGPT
export type ConnectorPrincipal = NamedPrincipal & {
  readonly actor: z.infer<typeof assistantActorSchema>;
};

export const isConnectorPrincipal = (principal: Principal): principal is ConnectorPrincipal =>
  principal.actor.kind === "assistant";

export const isAppPrincipal = (principal: Principal): principal is AppPrincipal =>
  principal.actor.kind === "device" || principal.actor.kind === "session";

export const isNamedPrincipal = (principal: Principal): principal is NamedPrincipal =>
  principal.actor.kind !== "agent";

// whether the principal may change the library, not only read it
export const changesLibrary = (principal: Principal): boolean =>
  principal.scopes.includes("library");

// a header carries Latin-1 alone and a device's name may hold any letter, so the JSON is
// percent-encoded
/** @internal */
export const principalHeaderValue = (principal: NamedPrincipal): string =>
  encodeURIComponent(JSON.stringify(principalSchema.parse(principal)));

// what the cell is never handed: any identity header the request brought, since the Worker stamps
// its own, and its credentials, which the cell never reads
const FORWARD_DROPS = [PRINCIPAL_HEADER, SOCKET_HOLDER_HEADER, "authorization", "cookie"] as const;

export const headersForCell = (request: Request): Headers => {
  const headers = new Headers(request.headers);
  for (const name of FORWARD_DROPS) {
    headers.delete(name);
  }
  return headers;
};

// a call forwarded whole into the account's cell, carrying the principal the Worker verified and
// nothing the caller sent in its place: an app's on `/v1/rpc` and an assistant's on the connector
export const forwardAsPrincipal = async (
  exports: Cloudflare.Exports,
  request: Request,
  principal: NamedPrincipal,
): Promise<Response> => {
  const headers = headersForCell(request);
  headers.set(PRINCIPAL_HEADER, principalHeaderValue(principal));
  return await libraryCell(exports, principal.accountId).fetch(new Request(request, { headers }));
};

// the principal a header names, never the built-in agent's
export const principalFromHeader = (value: string | null): NamedPrincipal | null => {
  if (value === null) {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(decodeURIComponent(value));
  } catch {
    return null;
  }
  const principal = principalSchema.safeParse(raw);
  return principal.success ? principal.data : null;
};

// the actor a principal's writes are by, in History's words for it
export const cellActorOf = (principal: NamedPrincipal): CellActor => {
  const { actor } = principal;
  switch (actor.kind) {
    case "device": {
      return { deviceId: actor.deviceId, kind: "person", label: `You on ${actor.deviceName}` };
    }
    case "session": {
      return { deviceId: actor.sessionId, kind: "person", label: "You in the browser" };
    }
    // every call under one grant joins one set, sealed after its quiet (`./cell-actor`)
    case "assistant": {
      return {
        clientId: actor.clientId,
        grantId: actor.grantId,
        kind: "assistant",
        label: actor.clientName,
      };
    }
    // no default
  }
};
