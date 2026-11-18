// eve doesn't check who owns a session, so its channel (apps/web/agent/channels/eve.ts) admits a
// request only with the app's token for that very session (`./eve-token`), and one that acts only
// while its thread still stands. Stopping one (cancel, end) needs only the token: a deleted
// thread's session must still retire.

import { z } from "zod";

import { threadOf } from "./agent-threads";
import type { AgentCaller } from "./platform";
import type { EveTokenSubject } from "./eve-token";
import { eveOperationId, verifyEveToken } from "./eve-token";

const ISSUER = "inteligir";

const CREATE_ROUTE = /^\/eve\/v1\/session\/?$/u;
const SESSION_ROUTE = /^\/eve\/v1\/session\/(?<sessionId>[^/]+)(?<action>\/[a-z]+)?\/?$/u;

// what follows a session's id, by method; every other route (info, clear) is refused
const SESSION_ACTIONS: ReadonlyMap<string, { kind: "act" | "stop"; method: string }> = new Map([
  ["", { kind: "act", method: "POST" }],
  ["/stream", { kind: "act", method: "GET" }],
  ["/compact", { kind: "act", method: "POST" }],
  ["/cancel", { kind: "stop", method: "POST" }],
  ["/end", { kind: "stop", method: "POST" }],
]);

type EveRoute =
  | { readonly kind: "create" }
  | { readonly kind: "act" | "stop"; readonly eveSessionId: string }
  | { readonly kind: "refused" };

const routeOf = (method: string, pathname: string): EveRoute => {
  if (method === "POST" && CREATE_ROUTE.test(pathname)) {
    return { kind: "create" };
  }
  const groups = SESSION_ROUTE.exec(pathname)?.groups;
  const action = SESSION_ACTIONS.get(groups?.action ?? "");
  const sessionId = groups?.sessionId;
  if (sessionId === undefined || action?.method !== method) {
    return { kind: "refused" };
  }
  try {
    return { eveSessionId: decodeURIComponent(sessionId), kind: action.kind };
  } catch {
    return { kind: "refused" };
  }
};

// whether a request creates a session: the only one whose body (`operationId`) is read
export const isSessionCreate = (method: string, pathname: string): boolean =>
  routeOf(method, pathname).kind === "create";

interface EveRequest {
  readonly method: string;
  // a session create's `operationId`, when it has one
  readonly operationId: string | null;
  readonly pathname: string;
  readonly token: string | null;
}

const callerAttributesSchema = z.object({
  eveSessionNumber: z.coerce.number().int().positive(),
  threadId: z.uuid(),
});

// eve's `SessionAuthContext`, by structure: the session's caller, as its tools and hooks read it
export interface EvePrincipal {
  // eve keeps only strings
  readonly attributes: Record<keyof z.input<typeof callerAttributesSchema>, string>;
  readonly authenticator: typeof ISSUER;
  readonly issuer: typeof ISSUER;
  readonly principalId: string;
  readonly principalType: "user";
  readonly subject: string;
}

type EveAdmission =
  | { readonly ok: true; readonly principal: EvePrincipal }
  | { readonly ok: false; readonly status: 401 | 403; readonly message: string };

const refuse = (status: 401 | 403, message: string): EveAdmission => ({
  message,
  ok: false,
  status,
});

// why the token can't open this route, or null when it can
const routeRefusal = (
  route: EveRoute,
  token: EveTokenSubject,
  operationId: string | null,
): string | null => {
  switch (route.kind) {
    case "refused": {
      return "Agent tokens open only their own session's messages, stream, cancel and end.";
    }
    case "create": {
      if (token.eveSessionId !== null) {
        return "This token is for a session that exists; it can't start one.";
      }
      return operationId === eveOperationId(token.threadId, token.eveSessionNumber)
        ? null
        : "A new session must name the token's thread and session number as its operationId.";
    }
    case "act":
    case "stop": {
      if (token.eveSessionId === null) {
        return "This token can only start a session.";
      }
      return token.eveSessionId === route.eveSessionId
        ? null
        : "This token is for a different session.";
    }
    // no default
  }
};

export const principalOf = (subject: EveTokenSubject): EvePrincipal => ({
  attributes: {
    eveSessionNumber: String(subject.eveSessionNumber),
    threadId: subject.threadId,
  },
  authenticator: ISSUER,
  issuer: ISSUER,
  principalId: subject.accountId,
  principalType: "user",
  subject: subject.accountId,
});

export const admitEveRequest = async (request: EveRequest): Promise<EveAdmission> => {
  if (request.token === null) {
    return refuse(401, "An agent token is required.");
  }
  const verified = await verifyEveToken(request.token);
  if (!verified.ok) {
    return refuse(401, verified.message);
  }
  const { subject } = verified;
  const route = routeOf(request.method, request.pathname);
  const refusal = routeRefusal(route, subject, request.operationId);
  if (refusal !== null) {
    return refuse(403, refusal);
  }
  if (route.kind !== "stop" && (await threadOf(subject.accountId, subject.threadId)) === null) {
    return refuse(403, "This conversation was deleted.");
  }
  return { ok: true, principal: principalOf(subject) };
};

// The caller of an eve session as admitted here: eve hands it back with its attributes widened to
// strings, so it is parsed again. Every session was admitted, so a miss is a bug, not a refusal
export const eveCallerOf = (
  auth: { readonly attributes: unknown; readonly principalId: string } | null | undefined,
): AgentCaller => {
  if (auth === null || auth === undefined) {
    throw new Error("This eve session has no caller: the channel admits none without a token.");
  }
  return { ...callerAttributesSchema.parse(auth.attributes), accountId: auth.principalId };
};
