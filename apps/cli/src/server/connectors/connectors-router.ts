import { CONNECTOR_OAUTH_CALLBACK_PATH } from "@repo/api/local/connectors/connectors-schema";
import { ORPCError } from "@orpc/server";
import { base } from "../orpc";
import { loopbackRequestOrigin } from "../loopback-origin";
import { ConnectorConflictError } from "./connectors-service";

type ConnectorConflictKind = ConnectorConflictError["kind"];

const CONNECTOR_REFUSALS = {
  "already-exists": "ALREADY_EXISTS",
  "not-found": "NOT_FOUND",
} as const satisfies Record<ConnectorConflictKind, string>;

// only the kind the contract row declares is translated; any other refusal stays a 500
// rather than defaulting into a class the row does not declare.
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

// the port comes from the request's own host header, never the configured one.
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
    // a failed open is an ordinary answer: the url works pasted anywhere.
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
  remove,
  toggle,
  oauthBegin,
  oauthDisconnect,
};
