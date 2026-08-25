// The connectors handlers. The service decides; this layer only says which
// refusal class each throw answers with.
//
// THE MAPPING IS ONE TABLE, and WHICH kind a given procedure translates is
// declared per handler. `CONNECTOR_REFUSALS` is TOTAL over
// `ConnectorConflictError` — `satisfies` makes a new kind a compile error
// there — while each handler names the ONE kind its contract row declares, so
// the other rethrows into the generic 500 and a new class arriving is decided
// per procedure rather than defaulted.

import { CONNECTOR_OAUTH_CALLBACK_PATH } from "@repo/api/local/connectors/connectors-schema";
import { ORPCError } from "@orpc/server";
import { base } from "../orpc";
import { loopbackRequestOrigin } from "../loopback-origin";
import { ConnectorConflictError } from "./connectors-service";

type ConnectorConflictKind = ConnectorConflictError["kind"];

/** Every way a connector write can refuse, and the wire class it is. The HTTP
 *  status each answers is the handler's (error-status.ts), not this layer's —
 *  oRPC v2 keeps none on the error. */
const CONNECTOR_REFUSALS = {
  "already-exists": "ALREADY_EXISTS",
  "not-found": "NOT_FOUND",
} as const satisfies Record<ConnectorConflictKind, string>;

/** Runs `work`, re-raising `declared` as the class the contract row declares.
 *  Any other refusal — including the conflict kind this row does not declare —
 *  is rethrown as it came, which is a 500 and should be. */
async function refusing<T>(
  declared: ConnectorConflictKind,
  work: () => T | Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (cause) {
    if (cause instanceof ConnectorConflictError && cause.kind === declared) {
      throw new ORPCError(CONNECTOR_REFUSALS[cause.kind], { message: cause.message });
    }
    throw cause;
  }
}

/** The callback URL for a request that reached this app's own loopback origin
 *  — the pair-callback rule: the PORT is the caller's own Host header's fact,
 *  never the configured guess. */
function oauthCallbackUrlFor(host: string | undefined): string | null {
  const origin = loopbackRequestOrigin(host);
  return origin === null ? null : `${origin}${CONNECTOR_OAUTH_CALLBACK_PATH}`;
}

const list = base.connectors.list.handler(({ context }) => ({
  servers: context.connectors.list(),
}));

const add = base.connectors.add.handler(({ context, input }) =>
  refusing("already-exists", () => ({ servers: context.connectors.add(input) })),
);

const update = base.connectors.update.handler(({ context, input }) =>
  refusing("not-found", () => ({ servers: context.connectors.update(input) })),
);

const remove = base.connectors.remove.handler(({ context, input }) =>
  refusing("not-found", () => ({ servers: context.connectors.remove(input.name) })),
);

const toggle = base.connectors.toggle.handler(({ context, input }) =>
  refusing("not-found", () => ({ servers: context.connectors.toggle(input.name, input.enabled) })),
);

const oauthBegin = base.connectors.oauthBegin.handler(async ({ context, input, errors }) => {
  const callbackUrl = oauthCallbackUrlFor(context.requestHost);
  if (callbackUrl === null) {
    throw errors.BAD_REQUEST({
      message:
        "Authorization must be started from this app's own address (127.0.0.1 or localhost).",
    });
  }
  return refusing("not-found", async () => {
    const url = await context.connectorsOauth.begin(input.name, callbackUrl);
    // A failed open is an ordinary answer: the URL works pasted anywhere.
    const opened = input.open ? await context.openExternalUrl(url) : false;
    return { opened, url };
  });
});

const oauthDisconnect = base.connectors.oauthDisconnect.handler(({ context, input }) =>
  refusing("not-found", () => {
    context.connectorsOauth.disconnect(input.name);
    return { servers: context.connectors.list() };
  }),
);

export const connectorsRouter = {
  list,
  add,
  update,
  remove,
  toggle,
  oauthBegin,
  oauthDisconnect,
};
