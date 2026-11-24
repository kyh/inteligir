import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { expo } from "@better-auth/expo";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@repo/contract/account/account-schema";
import { PHONE_ORIGIN } from "@repo/contract/origin";
import { db } from "@repo/db/drizzle-client";
import { betterAuth } from "better-auth";
import { createAuthMiddleware, isAPIError } from "better-auth/api";
import { bearer } from "better-auth/plugins/bearer";

import { keepDeletedAccountSessions } from "../agent/deleted-account-sessions";
import { APP_URL, DEPLOYMENT_ORIGIN } from "../app-url";
import { startBackground } from "../background";
import { env } from "../env";
import { AUTH_RATE_WINDOW_SECONDS } from "../rate-limit";
import { CLIENT_IP } from "../client-ip";
import { revokeAllAssistants } from "./connected-assistants";
import { forgetInviteRedeemer } from "./invite-codes";
import { oauthPlugins } from "./oauth";
import { sendResetEmail } from "./reset-email";
import { EMAIL_MODE, emailModeWarning } from "./send-email";
import { capSessions } from "./session-devices";

const sendsEmail = EMAIL_MODE.kind !== "off";

const DAY_SECONDS = 24 * 60 * 60;

const createAuth = (disableSignUp: boolean) =>
  betterAuth({
    advanced: {
      backgroundTasks: {
        handler: (task) => {
          startBackground(async () => {
            await task;
          }, "auth");
        },
      },
      disableOriginCheck: false,
      ipAddress: { ...CLIENT_IP },
    },
    baseURL: APP_URL,
    database: drizzleAdapter(db, { provider: "pg" }),
    databaseHooks: {
      session: {
        create: {
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
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      onPasswordReset: async ({ user }) => {
        await revokeAllAssistants(user.id);
      },
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: sendsEmail
        ? async ({ user, url }) => {
            await sendResetEmail(user.email, url);
          }
        : undefined,
    },
    hooks: {
      after: createAuthMiddleware(async (endpoint) => {
        if (endpoint.path === "/sign-out" && !isAPIError(endpoint.context.returned)) {
          endpoint.setHeader("clear-site-data", '"cache"');
        }

        await Promise.resolve();
      }),
    },
    plugins: [bearer({ requireSignature: true }), expo(), ...oauthPlugins()],
    rateLimit: {
      customRules: { "/get-session": false },
      enabled: !env.RATE_LIMIT_DISABLED,
      max: 10,
      storage: "database",
      window: AUTH_RATE_WINDOW_SECONDS,
    },
    secret: env.BETTER_AUTH_SECRET,
    session: {
      expiresIn: 60 * DAY_SECONDS,
      updateAge: DAY_SECONDS,
    },
    trustedOrigins: [PHONE_ORIGIN, ...(DEPLOYMENT_ORIGIN === null ? [] : [DEPLOYMENT_ORIGIN])],
    user: {
      deleteUser: {
        beforeDelete: async (user) => {
          await forgetInviteRedeemer(user.email);
          await keepDeletedAccountSessions(user.id, Date.now());
        },
        enabled: true,
      },
    },
  });

type Auth = ReturnType<typeof createAuth>;

let made: Auth | null = null;
let gate: Auth | null = null;

export const getAuth = () => {
  if (made === null) {
    const emailWarning = emailModeWarning(EMAIL_MODE, process.env.NODE_ENV === "production");

    if (emailWarning !== null) {
      console.warn(`[auth] ${emailWarning}`);
    }

    made = createAuth(true);
  }

  return made satisfies Auth;
};

export const getSignUpAuth = () => {
  gate ??= createAuth(false);

  return gate satisfies Auth;
};

export const sessionCredential = (headers: Pick<Headers, "get">) => {
  const authorization = headers.get("authorization");

  if (authorization !== null) {
    return new Headers({ authorization }) satisfies Headers;
  }

  const cookie = headers.get("cookie");

  return new Headers(cookie === null ? {} : { cookie }) satisfies Headers;
};

export const readSession = async (headers: Pick<Headers, "get">) =>
  await getAuth().api.getSession({
    headers: sessionCredential(headers),
    query: { disableRefresh: true },
  });

const AUTH_TOKEN_HEADER = "set-auth-token";

export const withoutAuthToken = (answer: Response) => {
  if (!answer.headers.has(AUTH_TOKEN_HEADER)) {
    return answer satisfies Response;
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
  }) satisfies Response;
};
