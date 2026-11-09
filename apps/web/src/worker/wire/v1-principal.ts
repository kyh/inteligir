// The principal a `/v1` request's credential verifies to, resolved in the Worker's HTTP layer and
// handed to every procedure as its context, read lazily and at most once a request
// (https://orpc.dev/docs/integrations/better-auth). A session is read by the door the request came
// through, each one a mark no other page can forge:
//
// - a bearer is the browser extension's, the browser's own session cookie read from its jar. The
//   cookie beside it is never read, so a bearer that fails is refused, never retried as the
//   cookie.
// - a request the site's own page made, which a browser marks same-origin, is a tab's or the Mac
//   app's window, on its cookie.
// - a request naming the phone's app scheme in `expo-origin` is the phone's, on the cookie it
//   keeps: a page cannot send that header without a preflight, which no route of the Worker's
//   answers.

import { PHONE_ORIGIN } from "@repo/contract/cloud/origin";

import { readSession } from "../auth/auth";
import type { AppPrincipal, SessionDoor } from "../library/library-principal";

const doorOf = (request: Request): SessionDoor | null => {
  const { headers } = request;
  if (headers.has("authorization")) {
    return "extension";
  }
  if (headers.get("sec-fetch-site") === "same-origin") {
    return "page";
  }
  return headers.get("expo-origin") === PHONE_ORIGIN ? "phone" : null;
};

const verifyPrincipal = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<AppPrincipal | null> => {
  const door = doorOf(request);
  if (door === null) {
    return null;
  }
  const signedIn = await readSession(env, ctx, request);
  return signedIn === null
    ? null
    : {
        accountId: signedIn.user.id,
        actor: { door, kind: "session", sessionId: signedIn.session.id },
      };
};

// the request's principal, verified on the first ask and shared by every later one
export const lazyPrincipal = (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): (() => Promise<AppPrincipal | null>) => {
  let verified: Promise<AppPrincipal | null> | undefined;
  return async () => {
    verified ??= verifyPrincipal(request, env, ctx);
    return await verified;
  };
};

// the window a principal's calls spend: its session's
export const holderIdOf = (principal: AppPrincipal): string => principal.actor.sessionId;
