// The account's procedures, which the Worker answers itself on `/v1/rpc/account`: a device
// credential's sign-in and sign-up, signing out, the browser extension's credential, the account's
// devices, its sessions beside its device credentials, its deletion with the password asked again,
// the socket's ticket, and the assistants let in through the connector. A signed row meets its
// credential in one middleware, verified lazily from the request's context (`./v1-principal`); a
// sign-in or sign-up spends its caller's window. The sessions' cores are `../auth/session-devices`
// and `../auth/delete-account`; the device credentials', which mint, verify and revoke them,
// `../device/*`.

import {
  TooManyRequestsError,
  UnauthorizedError,
  V1_ERROR_STATUS_MAP,
} from "@repo/contract/cloud/v1/errors";
import { implement, onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { RequestLimitHandlerPlugin } from "@orpc/server/plugins";
import { V1_RPC_PATH, v1Contract } from "@repo/contract/cloud/v1";
import { eq } from "drizzle-orm";

import { createAuth, createSignUpAuth } from "../auth/auth";
import { deleteAccountUnderSession } from "../auth/delete-account";
import { listSessionDevices, revokeSessionDevice } from "../auth/session-devices";
import { listAssistants, revokeAssistant } from "../connector/assistant-grants";
import { connectorAuth } from "../connector/connector-auth";
import { createDb } from "../db/client";
import { user } from "../db/schema";
import { deleteAccountWithPassword } from "../device/account";
import { listDevices, revokeDevice } from "../device/devices";
import { loginDevice, mintDeviceCredential } from "../device/login";
import { signUpDevice } from "../device/sign-up";
import type { AppPrincipal } from "../library/library-principal";
import { mintSocketTicket } from "../library/socket-ticket";
import { spendCallerBudget, spendHolderBudget } from "../rate-limit";
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
  if (!(await spendHolderBudget(context.env, db, "rpc", holderIdOf(principal)))) {
    throw new TooManyRequestsError();
  }
  return await next({ context: { db, signedIn: principal } });
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
  // the site's own page alone mints the extension its credential, on its session: a device's, the
  // phone's or the extension's could otherwise mint credentials that outlive its own end. The
  // session stays, the site's own
  connectExtension: os.connectExtension
    .use(signedIn)
    .handler(async ({ context, errors, input }) => {
      const { db, signedIn: principal } = context;
      if (principal.actor.kind !== "session" || principal.actor.door !== "page") {
        throw errors.UNAUTHORIZED();
      }
      const owner = await db
        .select({ email: user.email, id: user.id })
        .from(user)
        .where(eq(user.id, principal.accountId))
        .get();
      if (owner === undefined) {
        throw errors.GONE();
      }
      const minted = await mintDeviceCredential(db, {
        deviceName: input.deviceName,
        sessionToken: null,
        user: owner,
      });
      if (minted === null) {
        throw errors.DEVICE_LIMIT();
      }
      return minted;
    }),
  delete: os.delete.use(signedIn).handler(async ({ context, errors, input }) => {
    const { db, env, signedIn: principal } = context;
    if (!(await spendHolderBudget(env, db, "accountDelete", holderIdOf(principal)))) {
      throw errors.TOO_MANY_REQUESTS();
    }
    const deletion =
      principal.actor.kind === "session"
        ? await deleteAccountUnderSession(env, context.ctx, context.request, input.password)
        : await deleteAccountWithPassword(env, context.ctx, db, {
            origin: originOf(context.request),
            password: input.password,
            userId: principal.accountId,
          });
    switch (deletion) {
      case "gone": {
        throw errors.GONE();
      }
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
      const [sessions, credentials] = await Promise.all([
        listSessionDevices(
          context.db,
          accountId,
          actor.kind === "session" ? actor.sessionId : null,
        ),
        listDevices(context.db, accountId, actor.kind === "device" ? actor.deviceId : null),
      ]);
      return {
        devices: [...sessions, ...credentials].toSorted((a, b) => a.createdAt - b.createdAt),
      };
    }),
    // the session or the device credential by that id, among the account's own alone
    revoke: os.devices.revoke.use(signedIn).handler(async ({ context, errors, input }) => {
      const id = "id" in input ? input.id : input.deviceId;
      const userId = context.signedIn.accountId;
      const revoked =
        (await revokeSessionDevice(await internalAdapterOf(context), context.db, { id, userId })) ||
        (await revokeDevice(context.ctx, context.db, { deviceId: id, userId }));
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
    const result = await loginDevice(db, createAuth(env, context.ctx, originOf(request)), input);
    if (!result.loggedIn) {
      throw result.failure === "device-limit"
        ? errors.DEVICE_LIMIT()
        : errors.INVALID_CREDENTIALS();
    }
    return result.response;
  }),
  // the credential that asks: a device's is revoked, and a session ends, its sockets with it
  signOut: os.signOut.use(signedIn).handler(async ({ context }) => {
    const { actor, accountId } = context.signedIn;
    await (actor.kind === "device"
      ? revokeDevice(context.ctx, context.db, { deviceId: actor.deviceId, userId: accountId })
      : revokeSessionDevice(await internalAdapterOf(context), context.db, {
          id: actor.sessionId,
          userId: accountId,
        }));
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
      createSignUpAuth(env, context.ctx, originOf(request)),
      input,
    );
    if (result.signedUp) {
      return result.response;
    }
    throw result.failure === "invite-refused" ? errors.FORBIDDEN() : errors.ACCOUNT_EXISTS();
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
