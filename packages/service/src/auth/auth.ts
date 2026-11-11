import { expo } from "@better-auth/expo";
import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins/bearer";
// relations-v2: the adapter better-auth re-exports reads `db._.fullSchema`, gone in drizzle 1.0
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { PHONE_ORIGIN } from "@repo/contract/origin";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@repo/contract/account/account-schema";
import { EXTENSION_ORIGIN } from "@repo/contract/extension/extension-identity";
import { createDb } from "@repo/db/d1/client";
import { authTables } from "@repo/db/d1/schema";
import { AUTH_RATE_WINDOW_SECONDS, CALLER_ADDRESS } from "../rate-limit";
import { libraryCell } from "../library/library-cell";
import { severSockets } from "../library/socket-routes";
import { sendResetEmail } from "./reset-email";
import { capSessions } from "./session-devices";

// Built per request: D1 is a runtime binding, not a module singleton. No baseURL config —
// it is derived from the request origin, so localhost, preview and prod need none.

// The HTTP router's alone: auth.api still calls each. Every device calls sign-in, get-session and
// sign-out, the site the reset pair too, and the invite gate forwards sign-up; a route no client
// calls is surface with no user. `/callback/:id` stays, since an exact list cannot name it, and with
// no social provider it has nothing to sign in with; the phone's plugin's proxy goes, since it
// serves social sign-in alone. Deletion's one door is
// `account.delete` (../wire/account-router.ts), which asks the password again, where Better Auth's
// own route settles for a fresh session; listing and ending sessions are `account.devices.*`, which
// never hand a token out.
const DISABLED_PATHS = [
  "/account-info",
  "/change-email",
  "/change-password",
  "/delete-user",
  "/delete-user/callback",
  "/error",
  "/expo-authorization-proxy",
  "/get-access-token",
  "/link-social",
  "/list-accounts",
  "/list-sessions",
  "/ok",
  "/refresh-token",
  "/revoke-other-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/send-verification-email",
  "/sign-in/social",
  "/unlink-account",
  "/update-session",
  "/update-user",
  "/verify-email",
  "/verify-password",
];

const DAY_SECONDS = 24 * 60 * 60;

const buildAuth = (env: Env, ctx: ExecutionContext, baseURL: string, disableSignUp: boolean) =>
  betterAuth({
    advanced: {
      // past the answer: an unknown address sends no reset mail, so a request that waited on one
      // would say by its time which addresses hold an account
      backgroundTasks: {
        handler: (task) => {
          ctx.waitUntil(task);
        },
      },
      // the default reads x-forwarded-for and, finding more than one hop there, keys every such
      // caller into one bucket per path
      ipAddress: CALLER_ADDRESS,
    },
    baseURL,
    database: drizzleAdapter(createDb(env.DB), { provider: "sqlite", schema: authTables }),
    databaseHooks: {
      session: {
        create: {
          // every session starts inside one of Better Auth's endpoints, which hands its context
          before: async (starting, endpoint) => {
            if (endpoint !== null) {
              await capSessions(endpoint.context.internalAdapter, starting.userId);
            }
          },
        },
        // every session Better Auth ends, a sign-out, an end from Settings, the cap's and each one
        // a password reset revokes, closes the sockets it opened, whose standing was checked only
        // at their upgrade (../library/socket-routes.ts)
        delete: {
          after: async (ended) => {
            await severSockets(ctx.exports, ended.userId, { id: ended.id, kind: "session" });
          },
        },
      },
    },
    disabledPaths: DISABLED_PATHS,
    emailAndPassword: {
      disableSignUp,
      enabled: true,
      // set from the contract, not left at the defaults: the invite gate, the sign-in forms and the
      // reset page bound a password by the same two numbers, so none can drift from what this enforces
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      // every device is signed in by a session, so a reset, most often for a password that got
      // out, signs every one of them out, the phone and the extension's browser included
      revokeSessionsOnPasswordReset: true,
      // the forgot-password page requests with redirectTo /app/reset-password and any way back the
      // person came with, so the URL's GET leg lands on the site's route
      // (apps/web/src/routes/_site/app/reset-password.tsx)
      sendResetPassword: async ({ user, url }) => {
        await sendResetEmail(env, user.email, url);
      },
    },
    plugins: [
      // the extension reads the browser's own session cookie and sends it as a bearer; its value
      // is signed, so a raw token from a row or a log opens nothing
      bearer({ requireSignature: true }),
      // the phone's sign-in names its app scheme in `expo-origin`, which a native request sends in
      // place of the `Origin` a browser would
      expo(),
    ],
    // D1 storage: the default in-memory store is per isolate, so the limit multiplies across isolates and resets on recycle
    rateLimit: {
      // a session read proves nothing about a password, and every route guard and hover preload
      // spends one, so a limit here throttles browsing rather than guessing
      customRules: { "/get-session": false },
      // off in tests: the in-process Worker shares one IP, so a multi-user suite trips it
      enabled: env.RATE_LIMIT_DISABLED !== "true",
      max: 10,
      storage: "database",
      window: AUTH_RATE_WINDOW_SECONDS,
    },
    secret: env.BETTER_AUTH_SECRET,
    // no cookie cache: every read meets the row, so a session ended anywhere is refused on the
    // next call
    session: {
      // a phone opened every few weeks keeps its sign-in, and each day of use slides it on
      expiresIn: 60 * DAY_SECONDS,
      updateAge: DAY_SECONDS,
    },
    // the site's own origin is the request's, trusted as the baseURL; never a pattern over
    // `chrome-extension://`, which would trust every extension installed beside ours
    trustedOrigins: [EXTENSION_ORIGIN, PHONE_ORIGIN],
    user: {
      deleteUser: {
        // beforeDelete, not afterDelete: a failure aborts the deletion and the account survives to
        // retry. The library cell runs the account's purge in its order
        // (../library/account-purge.ts), and the sessions go after it, with the account.
        beforeDelete: async (user) => {
          await libraryCell(ctx.exports, user.id).purge(user.email);
        },
        enabled: true,
      },
    },
  });

export const createAuth = (env: Env, ctx: ExecutionContext, baseURL: string) =>
  buildAuth(env, ctx, baseURL, true);

// what Better Auth reads a request's session from, and nothing else of it: its bearer alone when
// it carries one, so a bearer that fails is never retried as the cookie beside it, which the
// bearer plugin would do
export const sessionCredential = (request: Request): Headers => {
  const authorization = request.headers.get("authorization");
  if (authorization !== null) {
    return new Headers({ authorization });
  }
  const cookie = request.headers.get("cookie");
  return new Headers(cookie === null ? {} : { cookie });
};

// the session a request names, for a route of the Worker's own: it answers with no cookie of
// Better Auth's, so a row slid here would outlive the cookie that names it
export const readSession = async (env: Env, ctx: ExecutionContext, request: Request) =>
  await createAuth(env, ctx, new URL(request.url).origin).api.getSession({
    headers: sessionCredential(request),
    query: { disableRefresh: true },
  });

const AUTH_TOKEN_HEADER = "set-auth-token";

// the bearer plugin copies each new session's token into a header page script can read, past the
// httpOnly cookie that keeps it from script; no client reads it, since the phone keeps its cookie
// and the extension reads the browser's, so every answer of Better Auth's goes out without it
export const withoutAuthToken = (answer: Response): Response => {
  if (!answer.headers.has(AUTH_TOKEN_HEADER)) {
    return answer;
  }
  const headers = new Headers(answer.headers);
  headers.delete(AUTH_TOKEN_HEADER);
  const exposed = (headers.get("access-control-expose-headers") ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "" && name.toLowerCase() !== AUTH_TOKEN_HEADER);
  if (exposed.length === 0) {
    headers.delete("access-control-expose-headers");
  } else {
    headers.set("access-control-expose-headers", exposed.join(", "));
  }
  return new Response(answer.body, {
    headers,
    status: answer.status,
    statusText: answer.statusText,
  });
};

// Better Auth reads disableSignUp off the instance options with no per-call override, so the
// invite gate (./invite.ts) needs this second instance; the flag also shuts auth.api.signUpEmail.
export const createSignUpAuth = (env: Env, ctx: ExecutionContext, baseURL: string) =>
  buildAuth(env, ctx, baseURL, false);
