// The default adapter entry reads `db._.fullSchema`, gone in drizzle 1.0; relations-v2 reads
// `db._.relations`
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { expo } from "@better-auth/expo";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@repo/contract/account/account-schema";
import { PHONE_ORIGIN } from "@repo/contract/origin";
import { EXTENSION_ORIGIN } from "@repo/contract/extension/extension-identity";
import { db } from "@repo/db/drizzle-client";
import { betterAuth } from "better-auth";
import { createAuthMiddleware, isAPIError } from "better-auth/api";
import { bearer } from "better-auth/plugins/bearer";

import { APP_URL } from "../app-url";
import { startBackground } from "../background";
import { env } from "../env";
import { AUTH_RATE_WINDOW_SECONDS } from "../rate-limit";
import { CLIENT_IP } from "./client-ip";
import { forgetInviteRedeemer } from "./invite-codes";
import { sendResetEmail } from "./reset-email";
import { EMAIL_MODE, emailModeWarning } from "./send-email";
import { capSessions } from "./session-devices";

// Off, Better Auth is handed no sender, so it refuses a reset up front rather than promise a link.
const sendsEmail = EMAIL_MODE.kind !== "off";

const DAY_SECONDS = 24 * 60 * 60;

const createAuth = (disableSignUp: boolean) =>
  betterAuth({
    advanced: {
      // past the answer: an unknown address sends no reset mail, so a request that waited on one
      // would say by its time which addresses hold an account
      backgroundTasks: {
        handler: (task) => {
          startBackground(async () => {
            await task;
          }, "auth");
        },
      },
      // on everywhere: Better Auth's default turns it off under a test runner, where the suites
      // would then pass requests production refuses
      disableOriginCheck: false,
      ipAddress: { ...CLIENT_IP },
    },
    baseURL: APP_URL,
    database: drizzleAdapter(db, { provider: "pg" }),
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
      },
    },
    emailAndPassword: {
      disableSignUp,
      enabled: true,
      // the contract's, so the invite gate, the forms and the reset page bound a password by the
      // numbers this enforces
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      // a reset, most often for a password that got out, signs every device out, the phone and the
      // extension's browser included
      revokeSessionsOnPasswordReset: true,
      // the forgot-password page names /app/reset-password, with any way back the person came with,
      // so the mailed link's GET leg lands on that page
      sendResetPassword: sendsEmail
        ? async ({ user, url }) => {
            await sendResetEmail(user.email, url);
          }
        : undefined,
    },
    hooks: {
      // a tab keeps each file it opened in the browser's cache, so a sign-out that went through
      // empties the site's cache too; a refused one empties nothing, since another site can send it
      after: createAuthMiddleware(async (endpoint) => {
        if (endpoint.path === "/sign-out" && !isAPIError(endpoint.context.returned)) {
          endpoint.setHeader("clear-site-data", '"cache"');
        }
        // a hook's type is async, and nothing here waits
        await Promise.resolve();
      }),
    },
    plugins: [
      // the extension reads the browser's own session cookie and sends it as a bearer; its value is
      // signed, so a raw token from a row or a log opens nothing
      bearer({ requireSignature: true }),
      // the phone's sign-in names its app scheme in `expo-origin`, which a native request sends in
      // place of the `Origin` a browser would
      expo(),
    ],
    // Counters in Postgres: in memory they would be per instance, so the limit would multiply across
    // instances and reset on every deploy.
    rateLimit: {
      // a session read proves nothing about a password, and every tab, phone and extension spends
      // one as it opens, so a limit here throttles use rather than guessing
      customRules: { "/get-session": false },
      enabled: !env.RATE_LIMIT_DISABLED,
      max: 10,
      storage: "database",
      window: AUTH_RATE_WINDOW_SECONDS,
    },
    secret: env.BETTER_AUTH_SECRET,
    // no cookie cache: every read meets the row, so a session ended anywhere is refused on the next
    // call
    session: {
      // a phone opened every few weeks keeps its sign-in, and each day of use slides it on
      expiresIn: 60 * DAY_SECONDS,
      updateAge: DAY_SECONDS,
    },
    // the app's own origin is trusted as the base URL; never a pattern over `chrome-extension://`,
    // which would trust every extension installed beside ours
    trustedOrigins: [EXTENSION_ORIGIN, PHONE_ORIGIN],
    user: {
      deleteUser: {
        // beforeDelete, not afterDelete: a failure aborts the deletion and the account survives to
        // retry. Its rows go with the user's by cascade; the invite it was made with only names it.
        beforeDelete: async (user) => {
          await forgetInviteRedeemer(user.email);
        },
        enabled: true,
      },
    },
  });

type Auth = ReturnType<typeof createAuth>;

let made: Auth | null = null;
let gate: Auth | null = null;

// Made on first use, so a build, which loads every route's modules, opens no database connection
// and logs nothing meant for whoever runs the deployment.
export const getAuth = (): Auth => {
  if (made === null) {
    const emailWarning = emailModeWarning(EMAIL_MODE, process.env.NODE_ENV === "production");
    if (emailWarning !== null) {
      console.warn(`[auth] ${emailWarning}`);
    }
    made = createAuth(true);
  }
  return made;
};

// Better Auth reads disableSignUp off the instance's options with no per-call override, so the
// invite gate (./invite.ts) and the seed need this second instance; the flag also shuts
// auth.api.signUpEmail on the first.
export const getSignUpAuth = (): Auth => {
  gate ??= createAuth(false);
  return gate;
};

// What Better Auth reads a request's session from, and nothing else of it: its bearer alone when it
// carries one, so a bearer that fails is never retried as the cookie beside it, which the bearer
// plugin would do.
export const sessionCredential = (headers: Pick<Headers, "get">): Headers => {
  const authorization = headers.get("authorization");
  if (authorization !== null) {
    return new Headers({ authorization });
  }
  const cookie = headers.get("cookie");
  return new Headers(cookie === null ? {} : { cookie });
};

// The session a request names, for a reader of the app's own that answers with no cookie of Better
// Auth's: a row it slid would outlive the cookie that names it, so only Better Auth's own route
// slides one.
export const readSession = async (headers: Pick<Headers, "get">) =>
  await getAuth().api.getSession({
    headers: sessionCredential(headers),
    query: { disableRefresh: true },
  });

const AUTH_TOKEN_HEADER = "set-auth-token";

// The bearer plugin copies each new session's token into a header page script can read, past the
// httpOnly cookie that keeps it from script; no client reads it, since the phone keeps its cookie
// and the extension reads the browser's, so every answer of Better Auth's goes out without it.
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
