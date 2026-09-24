import { CONNECTOR_OAUTH_CALLBACK_PATH } from "@repo/api/local/connectors/connectors-schema";
import { ORPCError } from "@orpc/server";
import { base } from "../orpc";
import { ConnectorConflictError } from "./connectors-service";

type ConnectorConflictKind = ConnectorConflictError["kind"];

const CONNECTOR_REFUSALS = {
  "already-exists": "ALREADY_EXISTS",
  "not-found": "NOT_FOUND",
} as const satisfies Record<ConnectorConflictKind, string>;

// only the kind the contract row declares is translated; any other refusal stays a 500
// rather than defaulting into a class the row does not declare.
const refusing = async <T>(
  declared: ConnectorConflictKind,
  work: () => T | Promise<T>,
): Promise<T> => {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ConnectorConflictError && error.kind === declared) {
      throw new ORPCError(CONNECTOR_REFUSALS[error.kind], { message: error.message });
    }
    throw error;
  }
};

const list = base.connectors.list.handler(({ context }) => ({
  servers: context.connectors.list(),
}));

const add = base.connectors.add.handler(
  async ({ context, input }) =>
    await refusing("already-exists", () => ({ servers: context.connectors.add(input) })),
);

const remove = base.connectors.remove.handler(
  async ({ context, input }) =>
    await refusing("not-found", () => ({ servers: context.connectors.remove(input.name) })),
);

const toggle = base.connectors.toggle.handler(
  async ({ context, input }) =>
    await refusing("not-found", () => ({
      servers: context.connectors.toggle(input.name, input.enabled),
    })),
);

const oauthBegin = base.connectors.oauthBegin.handler(async ({ context, input, errors }) => {
  if (context.requestOrigin === null) {
    throw errors.BAD_REQUEST({
      message:
        "Authorization must be started from this app's own address (127.0.0.1 or localhost).",
    });
  }
  const callbackUrl = `${context.requestOrigin}${CONNECTOR_OAUTH_CALLBACK_PATH}`;
  return await refusing("not-found", async () => {
    const begun = await context.connectorsOauth.begin(input.name, callbackUrl);
    if (!begun.ok) {
      throw errors.PROVIDER_UNAVAILABLE({ message: begun.detail });
    }
    // a failed open is an ordinary answer: the url works pasted anywhere.
    const opened = input.open ? await context.openExternalUrl(begun.url) : false;
    return { opened, url: begun.url };
  });
});

const oauthDisconnect = base.connectors.oauthDisconnect.handler(
  async ({ context, input }) =>
    await refusing("not-found", () => {
      context.connectorsOauth.disconnect(input.name);
      return { servers: context.connectors.list() };
    }),
);

export const connectorsRouter = {
  add,
  list,
  oauthBegin,
  oauthDisconnect,
  remove,
  toggle,
};
