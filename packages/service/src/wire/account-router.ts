// The account's procedures, which the Worker answers itself on `/v1/rpc/account`: the account's
// devices, each one of its sessions, its deletion with the password asked again, the socket's
// ticket, and the assistants let in through the connector. Every row runs for the principal its
// call was admitted under (`./v1-principal`). Their cores are `../auth/session-devices` and
// `../auth/delete-account`; signing in and out is Better Auth's own.

import { V1_ERROR_STATUS_MAP } from "@repo/contract/rpc/v1-errors";
import { implement, onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { RequestLimitHandlerPlugin } from "@orpc/server/plugins";
import { V1_RPC_PATH, v1Contract } from "@repo/contract/rpc/v1-contract";

import { createAuth } from "../auth/auth";
import { deleteAccountUnderSession } from "../auth/delete-account";
import { listSessionDevices, revokeSessionDevice } from "../auth/session-devices";
import { listAssistants, revokeAssistant } from "../connector/assistant-grants";
import { connectorAuth } from "../connector/connector-auth";
import { createDb } from "@repo/db/d1/client";
import type { Db } from "@repo/db/d1/client";
import type { AppPrincipal } from "../library/library-principal";
import { mintSocketTicket } from "../library/socket-ticket";
import { spendDeleteBudget } from "../rate-limit";
import { logRpcFailure } from "./rpc-log";

interface AccountContext {
  readonly env: Env;
  readonly ctx: ExecutionContext;
  readonly request: Request;
  readonly principal: AppPrincipal;
  readonly db: Db;
}

const os = implement(v1Contract.account).$context<AccountContext>();

const originOf = (request: Request): string => new URL(request.url).origin;

const internalAdapterOf = async (context: AccountContext) => {
  const authContext = await createAuth(context.env, context.ctx, originOf(context.request))
    .$context;
  return authContext.internalAdapter;
};

const accountRouter = os.router({
  // the assistants let in through the connector's consent page, each one grant
  assistants: {
    list: os.assistants.list.handler(async ({ context }) => ({
      assistants: await listAssistants(
        connectorAuth(context.env).helpers,
        context.db,
        context.principal.accountId,
      ),
    })),
    revoke: os.assistants.revoke.handler(async ({ context, errors, input }) => {
      const revoked = await revokeAssistant(
        connectorAuth(context.env).helpers,
        context.db,
        context.principal.accountId,
        input.grantId,
      );
      if (!revoked) {
        throw errors.NOT_FOUND();
      }
      return { revoked: true as const };
    }),
  },
  delete: os.delete.handler(async ({ context, errors, input }) => {
    const { db, env, principal } = context;
    if (!(await spendDeleteBudget(env, db, principal.actor.sessionId))) {
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
    list: os.devices.list.handler(async ({ context }) => {
      const { accountId, actor } = context.principal;
      return { devices: await listSessionDevices(context.db, accountId, actor.sessionId) };
    }),
    // the session by that id, among the account's own alone
    revoke: os.devices.revoke.handler(async ({ context, errors, input }) => {
      const revoked = await revokeSessionDevice(await internalAdapterOf(context), context.db, {
        id: input.id,
        userId: context.principal.accountId,
      });
      if (!revoked) {
        throw errors.NOT_FOUND();
      }
      return { revoked: true as const };
    }),
  },
  // a minute's ticket the account's socket opens with (`/v1/socket`), naming this session
  socketTicket: os.socketTicket.handler(async ({ context }) => {
    const { accountId, actor } = context.principal;
    return await mintSocketTicket(
      context.env.BETTER_AUTH_SECRET,
      { accountId, sessionId: actor.sessionId },
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
  env: Env,
  ctx: ExecutionContext,
  principal: AppPrincipal,
): Promise<Response | null> => {
  const { matched, response } = await handler.handle(request, {
    context: { ctx, db: createDb(env.DB), env, principal, request },
    prefix: V1_ACCOUNT_RPC_PATH,
  });
  return matched ? response : null;
};
