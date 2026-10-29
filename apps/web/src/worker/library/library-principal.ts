// Who a call to the library is by, as the Worker verified it: the account, what it may do, and the
// actor whose change set its writes join. The Worker resolves it from the credential the request
// carried (a device's bearer and a browser's session on `/v1`, an assistant's OAuth token on the
// connector), drops any copy the request brought, and stamps it on the request it forwards to the
// account's cell (`../wire/v1-rpc`, `../connector/connector-route`); the cell takes it from there
// alone, since only the Worker reaches a cell, and holds it to the account its own name gives.
// Procedures read it as their initial context and never a header.

import { z } from "zod";

import type { CellActor } from "./cell-actor";

export const PRINCIPAL_HEADER = "x-library-principal";

// what a credential may do with the library: `library` reads and changes it, and `library:read`,
// which only an assistant's grant can hold, reads it alone
export const LIBRARY_SCOPES = ["library", "library:read"] as const;

const holderId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);

// an app signed in on a device: the Mac, the phone, the extension
const deviceActorSchema = z.strictObject({
  deviceId: holderId,
  deviceName: z.string().min(1).max(128),
  kind: z.literal("device"),
});

// the library in a browser tab, signed in with the site's own session
const sessionActorSchema = z.strictObject({ kind: z.literal("session"), sessionId: holderId });

// the person's own assistant under one grant of the connector's consent page; its client id is a
// URL for a client that publishes its metadata, and its name is the client's own claim
const assistantActorSchema = z.strictObject({
  clientId: z.string().min(1).max(2048),
  clientName: z.string().min(1).max(128),
  grantId: holderId,
  kind: z.literal("assistant"),
});

export const principalSchema = z.strictObject({
  accountId: z.string().min(1).max(128),
  actor: z.discriminatedUnion("kind", [
    deviceActorSchema,
    sessionActorSchema,
    assistantActorSchema,
  ]),
  scopes: z.array(z.enum(LIBRARY_SCOPES)).min(1),
});

export type Principal = z.infer<typeof principalSchema>;

// what an app's credential verifies to on `/v1`, which takes no assistant
export type AppPrincipal = Principal & {
  readonly actor: z.infer<typeof deviceActorSchema> | z.infer<typeof sessionActorSchema>;
};

// an assistant's grant, the one actor the connector takes
export type AssistantPrincipal = Principal & {
  readonly actor: z.infer<typeof assistantActorSchema>;
};

export const isAssistantPrincipal = (principal: Principal): principal is AssistantPrincipal =>
  principal.actor.kind === "assistant";

export const isAppPrincipal = (principal: Principal): principal is AppPrincipal =>
  principal.actor.kind !== "assistant";

// whether the principal may change the library, not only read it
export const changesLibrary = (principal: Principal): boolean =>
  principal.scopes.includes("library");

// a header carries Latin-1 alone and a device's name may hold any letter, so the JSON is
// percent-encoded
export const principalHeaderValue = (principal: Principal): string =>
  encodeURIComponent(JSON.stringify(principalSchema.parse(principal)));

export const principalFromHeader = (value: string | null): Principal | null => {
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
export const cellActorOf = (principal: Principal): CellActor => {
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
