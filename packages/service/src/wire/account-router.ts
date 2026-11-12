// The account's procedures, which the Worker answers itself on `/v1/rpc/account`: the account's
// devices, each one of its sessions, its deletion with the password asked again, the socket's
// ticket, and the assistants let in through the connector. Every row meets its session in one
// middleware, verified lazily from the request's context (`./v1-principal`). Their cores are
// `../auth/session-devices` and `../auth/delete-account`; signing in and out is Better Auth's own.

import {
  TooManyRequestsError,
  UnauthorizedError,
  V1_ERROR_STATUS_MAP,
} from "@repo/contract/v1/errors";
import { implement, onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { RequestLimitHandlerPlugin } from "@orpc/server/plugins";
import { V1_RPC_PATH, v1Contract } from "@repo/contract/v1";

import { createAuth } from "../auth/auth";
import { deleteAccountUnderSession } from "../auth/delete-account";
import { listSessionDevices, revokeSessionDevice } from "../auth/session-devices";
import { listAssistants, revokeAssistant } from "../connector/assistant-grants";
import { connectorAuth } from "../connector/connector-auth";
import { createDb } from "@repo/db/d1/client";
import type { AppPrincipal } from "../library/library-principal";
import { mintSocketTicket } from "../library/socket-ticket";
import { spendCallBudget, spendDeleteBudget } from "../rate-limit";
import { logRpcFailure } from "./rpc-log";
import { holderIdOf } from "./v1-principal";

export interface AccountContext {
  readonly env: Env;
  readonly ctx: ExecutionContext;
  readonly request: Request;
  readonly principal: () => Promise<AppPrincipal | null>;
}

const os = implement(v1Contract.account).$context<AccountContext>();

// a row's caller: the principal its session verifies to, within its window; thrown as the error
// factories, since every row declares both and this middleware serves them all
const signedIn = os.middleware(async ({ context, next }) => {
  const principal = await context.principal();
  if (principal === null) {
    throw new UnauthorizedError();
  }
  if (!(await spendCallBudget(context.env, context.env.RPC_LIMIT, holderIdOf(principal)))) {
    throw new TooManyRequestsError();
  }
  return await next({ context: { db: createDb(context.env.DB), signedIn: principal } });
});

const originOf = (request: Request): string => new URL(request.url).origin;

const internalAdapterOf = async (context: AccountContext) => {
  const authContext = await createAuth(context.env, context.ctx, originOf(context.request))
    .$context;
  return authContext.internalAdapter;
};

const accountRouter = os.router({
  // the assistants let in through the connector's consent page, each one grant
  assistants: {
    list: os.assistants.list.use(signedIn).handler(async ({ context }) => ({
      assistants: await listAssistants(
        connectorAuth(context.env).helpers,
        context.db,
        context.signedIn.accountId,
      ),
    })),
    revoke: os.assistants.revoke.use(signedIn).handler(async ({ context, errors, input }) => {
      const revoked = await revokeAssistant(
        connectorAuth(context.env).helpers,
        context.db,
        context.signedIn.accountId,
        input.grantId,
      );
      if (!revoked) {
        throw errors.NOT_FOUND();
      }
      return { revoked: true as const };
    }),
  },
  delete: os.delete.use(signedIn).handler(async ({ context, errors, input }) => {
    const { db, env, signedIn: principal } = context;
    if (!(await spendDeleteBudget(env, db, holderIdOf(principal)))) {
      throw errors.TOO_MANY_REQUESTS();
    }
    const deletion = await deleteAccountUnderSession(
      env,
      context.ctx,
      context.request,
      input.password,
    );
    switch (deletion) {
      case "signed-out": {
        throw errors.UNAUTHORIZED();
      }
      case "invalid-credentials": {
        throw errors.INVALID_CREDENTIALS();
      }
      case "deleted": {
        return { deleted: true as const };
      }
      // no default
    }
  }),
  devices: {
    list: os.devices.list.use(signedIn).handler(async ({ context }) => {
      const { accountId, actor } = context.signedIn;
      return { devices: await listSessionDevices(context.db, accountId, actor.sessionId) };
    }),
    // the session by that id, among the account's own alone
    revoke: os.devices.revoke.use(signedIn).handler(async ({ context, errors, input }) => {
      const revoked = await revokeSessionDevice(await internalAdapterOf(context), context.db, {
        id: input.id,
        userId: context.signedIn.accountId,
      });
      if (!revoked) {
        throw errors.NOT_FOUND();
      }
      return { revoked: true as const };
    }),
  },
  // a minute's ticket the account's socket opens with (`/v1/socket`), naming this session
  socketTicket: os.socketTicket.use(signedIn).handler(async ({ context }) => {
    const { accountId, actor } = context.signedIn;
    return await mintSocketTicket(
      context.env.BETTER_AUTH_SECRET,
      { accountId, holder: { id: actor.sessionId, kind: "session" } },
      Date.now(),
    );
  }),
});

// an account call is a few fields: a password, an id
const ACCOUNT_RPC_MAX_BODY_BYTES = 64 * 1024;

const handler = new RPCHandler(accountRouter, {
  errorStatusMap: V1_ERROR_STATUS_MAP,
  interceptors: [
    onError((cause, { path }) => {
      logRpcFailure("account-rpc-failed", path, cause);
    }),
  ],
  plugins: [new RequestLimitHandlerPlugin({ maxBodySize: ACCOUNT_RPC_MAX_BODY_BYTES })],
});

const V1_ACCOUNT_RPC_PATH = `${V1_RPC_PATH}/account` as const;

// the call's answer, or null for a path no account row serves
export const serveAccountRpc = async (
  request: Request,
  context: AccountContext,
): Promise<Response | null> => {
  const { matched, response } = await handler.handle(request, {
    context,
    prefix: V1_ACCOUNT_RPC_PATH,
  });
  return matched ? response : null;
};
