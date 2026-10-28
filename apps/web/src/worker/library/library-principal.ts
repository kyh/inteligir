// Who a call to the library is by, as the Worker verified it: the account, what it may do, and the
// actor whose change set its writes join. The Worker resolves it from the credential the request
// carried (a device's bearer, a browser's session), drops any copy the request brought, and stamps
// it on the request it forwards to the account's cell (`../wire/v1-rpc`); the cell takes it from
// there alone, since only the Worker reaches a cell, and holds it to the account its own name
// gives. Procedures read it as their initial context and never a header.

import { z } from "zod";

import type { CellActor } from "./cell-actor";

export const PRINCIPAL_HEADER = "x-library-principal";

// what a credential may do with the library: every credential today, a device's and a browser
// session's, reads and changes it, so `library` is the one scope; a narrower one comes with the
// procedures that hold a call to it
const SCOPES = ["library"] as const;

const holderId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);

const actorSchema = z.discriminatedUnion("kind", [
  // an app signed in on a device: the Mac, the phone, the extension
  z.strictObject({
    deviceId: holderId,
    deviceName: z.string().min(1).max(128),
    kind: z.literal("device"),
  }),
  // the library in a browser tab, signed in with the site's own session
  z.strictObject({ kind: z.literal("session"), sessionId: holderId }),
]);

const principalSchema = z.strictObject({
  accountId: z.string().min(1).max(128),
  actor: actorSchema,
  scopes: z.array(z.enum(SCOPES)).min(1),
});

export type Principal = z.infer<typeof principalSchema>;

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
    // no default
  }
};
