// Who a call to the library is by: the account, and the actor its writes are by. The Worker
// resolves it from the credential the request carried (a session through the door it came by on
// `/v1`, an assistant's OAuth token on the connector) and hands it to the account's cell as an
// argument of the cell's own method, beside the request (`../wire/v1-rpc`,
// `../connector/connector-route`), so nothing a caller sends names one; the cell holds it to the
// account its own name gives. The built-in agent's principal is no argument's: the cell mints it in
// `agentTool`, for one turn of one thread, and its writes are refused once that turn is no longer
// open. Procedures read the actor a principal resolves to.

import { z } from "zod";

import type { CellActor } from "./cell-actor";

// what an assistant's grant may do with the library: `library` reads and changes it, and
// `library:read` reads it alone; an app and the built-in agent hold neither, having no such limit
export const LIBRARY_SCOPES = ["library", "library:read"] as const;

// the id a credential goes by: a session's or an assistant's grant
export const credentialIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);

// the door a session reached `/v1` by (`../wire/v1-principal`): the site's own page, a tab or the
// Mac app's window; the phone; the browser extension, on the browser's own session
const SESSION_DOORS = ["page", "phone", "extension"] as const;
export type SessionDoor = (typeof SESSION_DOORS)[number];

const accountIdSchema = z.string().min(1).max(128);

// what an app's session verifies to on `/v1`, which takes no assistant: one of Better Auth's
// sessions, whichever device signed it in
export const appPrincipalSchema = z.strictObject({
  accountId: accountIdSchema,
  actor: z.strictObject({
    door: z.enum(SESSION_DOORS),
    kind: z.literal("session"),
    sessionId: credentialIdSchema,
  }),
});

export type AppPrincipal = z.infer<typeof appPrincipalSchema>;

// what the connector takes: the person's own assistant under one grant of the connector's consent
// page; its client id is a URL for a client that publishes its metadata, its name is the client's
// own claim, and its scopes are what the person let that grant do
export const connectorPrincipalSchema = z.strictObject({
  accountId: accountIdSchema,
  actor: z.strictObject({
    clientId: z.string().min(1).max(2048),
    clientName: z.string().min(1).max(128),
    grantId: credentialIdSchema,
    kind: z.literal("assistant"),
    scopes: z.array(z.enum(LIBRARY_SCOPES)).min(1),
  }),
});

export type ConnectorPrincipal = z.infer<typeof connectorPrincipalSchema>;

// a principal the Worker verified at one of its doors
export type NamedPrincipal = AppPrincipal | ConnectorPrincipal;

// the built-in agent in one turn of one thread, which only the cell names
export interface AgentPrincipal {
  readonly accountId: string;
  readonly actor: { readonly kind: "agent"; readonly threadId: string; readonly turn: number };
}

export type Principal = NamedPrincipal | AgentPrincipal;

export const agentPrincipal = (
  accountId: string,
  turn: { readonly threadId: string; readonly turn: number },
): AgentPrincipal => ({
  accountId,
  actor: { kind: "agent", threadId: turn.threadId, turn: turn.turn },
});

export const isNamedPrincipal = (principal: Principal): principal is NamedPrincipal =>
  principal.actor.kind !== "agent";

// whether the grant may change the library, not only read it
export const changesLibrary = (principal: ConnectorPrincipal): boolean =>
  principal.actor.scopes.includes("library");

// a call as its cell is handed it: without the credentials it came by, which the cell never reads
export const withoutCredentials = (request: Request): Request => {
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.delete("cookie");
  return new Request(request, { headers });
};

// the actor a principal's writes are by
export const cellActorOf = (principal: NamedPrincipal): CellActor => ({
  kind: principal.actor.kind === "session" ? "person" : "assistant",
});
