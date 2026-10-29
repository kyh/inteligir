// The account's procedures, which the Worker answers itself on `/v1/rpc/account`: a device's
// sign-in and sign-up, signing out, the account's devices, its deletion with the password asked
// again, the socket's ticket, and the assistants let in through the connector. A signed row meets
// its credential in one middleware, verified lazily from the request's context
// (`./v1-principal`); a sign-in or sign-up spends its caller's window. Each row shares its core with the REST door today's apps still call (`../device/*`).

import {
  TooManyRequestsError,
  UnauthorizedError,
  V1_ERROR_STATUS_MAP,
} from "@repo/contract/cloud/v1/errors";
import { ORPCError, implement, onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { RequestLimitHandlerPlugin } from "@orpc/server/plugins";
import { V1_RPC_PATH, v1Contract } from "@repo/contract/cloud/v1";
import { eq } from "drizzle-orm";

import { createAuth, createSignUpAuth } from "../auth/auth";
import { listAssistants, revokeAssistant } from "../connector/assistant-grants";
import { connectorAuth } from "../connector/connector-auth";
import { createDb } from "../db/client";
import { session } from "../db/schema";
import { deleteAccountWithPassword } from "../device/account";
import { listDevices, revokeDevice } from "../device/devices";
import { loginDevice } from "../device/login";
import { signUpDevice } from "../device/sign-up";
import type { AppPrincipal } from "../library/library-principal";
import { mintSocketTicket } from "../library/socket-ticket";
import { spendCallerBudget, spendDeviceBudget } from "../rate-limit";
import { logRpcFailure } from "./rpc-log";
import { holderIdOf } from "./v1-principal";

export interface AccountContext {
  readonly env: Env;
  readonly ctx: ExecutionContext;
  readonly request: Request;
  readonly principal: () => Promise<AppPrincipal | null>;
}

const os = implement(v1Contract.account).$context<AccountContext>();

// a signed row's caller: the principal its credential verifies to, within its window; thrown as
// the error factories, since every signed row declares both and this middleware serves them all
const signedIn = os.middleware(async ({ context, next }) => {
  const principal = await context.principal();
  if (principal === null) {
    throw new UnauthorizedError();
  }
  const db = createDb(context.env.DB);
  if (!(await spendDeviceBudget(context.env, db, "rpc", holderIdOf(principal)))) {
    throw new TooManyRequestsError();
  }
  return await next({ context: { db, signedIn: principal } });
});

const originOf = (request: Request): string => new URL(request.url).origin;

const accountRouter = os.router({
  // the assistants let in through the connector's consent page, each one grant
  assistants: {
    list: os.assistants.list.use(signedIn).handler(async ({ context }) => ({
      assistants: await listAssistants(
        connectorAuth(context.env).helpers,
        context.signedIn.accountId,
      ),
    })),
    revoke: os.assistants.revoke.use(signedIn).handler(async ({ context, errors, input }) => {
      const revoked = await revokeAssistant(
        connectorAuth(context.env).helpers,
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
    if (!(await spendDeviceBudget(env, db, "accountDelete", holderIdOf(principal)))) {
      throw errors.TOO_MANY_REQUESTS();
    }
    const deletion = await deleteAccountWithPassword(env, context.ctx.exports, db, {
      origin: originOf(context.request),
      password: input.password,
      userId: principal.accountId,
    });
    switch (deletion) {
      case "gone": {
        throw errors.GONE();
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
    list: os.devices.list
      .use(signedIn)
      .handler(async ({ context }) => await listDevices(context.db, context.signedIn.accountId)),
    revoke: os.devices.revoke.use(signedIn).handler(async ({ context, errors, input }) => {
      const revoked = await revokeDevice(context.ctx, context.db, {
        deviceId: input.deviceId,
        userId: context.signedIn.accountId,
      });
      if (!revoked) {
        throw errors.NOT_FOUND();
      }
      return { revoked: true as const };
    }),
  },
  signIn: os.signIn.handler(async ({ context, errors, input }) => {
    const { env, request } = context;
    const db = createDb(env.DB);
    if (!(await spendCallerBudget(env, db, "login", request))) {
      throw errors.TOO_MANY_REQUESTS();
    }
    const result = await loginDevice(
      db,
      createAuth(env, context.ctx.exports, originOf(request)),
      input,
    );
    if (!result.loggedIn) {
      throw result.failure === "device-limit"
        ? errors.DEVICE_LIMIT()
        : errors.INVALID_CREDENTIALS();
    }
    return result.response;
  }),
  // the credential that asks: a device's is revoked, and a browser tab's session ends
  signOut: os.signOut.use(signedIn).handler(async ({ context }) => {
    const { actor, accountId } = context.signedIn;
    await (actor.kind === "device"
      ? revokeDevice(context.ctx, context.db, { deviceId: actor.deviceId, userId: accountId })
      : context.db.delete(session).where(eq(session.id, actor.sessionId)));
    return { revoked: true as const };
  }),
  signUp: os.signUp.handler(async ({ context, errors, input }) => {
    const { env, request } = context;
    const db = createDb(env.DB);
    // the site's invite gate spends this window too, so two doors are not twice the guesses
    if (!(await spendCallerBudget(env, db, "inviteSignUp", request))) {
      throw errors.TOO_MANY_REQUESTS();
    }
    const result = await signUpDevice(
      db,
      createSignUpAuth(env, context.ctx.exports, originOf(request)),
      input,
    );
    if (result.signedUp) {
      return result.response;
    }
    switch (result.failure) {
      case "invite-refused": {
        throw errors.FORBIDDEN();
      }
      case "account-exists": {
        throw errors.ACCOUNT_EXISTS();
      }
      case "bad-request": {
        throw new ORPCError("BAD_REQUEST", { message: result.message });
      }
      // no default
    }
  }),
  // a minute's ticket the account's socket opens with (`/v1/socket`), naming this credential
  socketTicket: os.socketTicket.use(signedIn).handler(async ({ context }) => {
    const principal = context.signedIn;
    const { actor } = principal;
    return await mintSocketTicket(
      context.env.BETTER_AUTH_SECRET,
      {
        accountId: principal.accountId,
        holder:
          actor.kind === "device"
            ? { id: actor.deviceId, kind: "device" }
            : { id: actor.sessionId, kind: "session" },
      },
      Date.now(),
    );
  }),
});

// an account call is a few fields: a password, a name, an invite code
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
