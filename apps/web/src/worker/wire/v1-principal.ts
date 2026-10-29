// The principal a `/v1` request's credential verifies to, resolved in the Worker's HTTP layer and
// handed to every procedure as its context: a device's bearer, checked against D1 on every call; or,
// for the library in this site's own tab, the session cookie Better Auth reads, read lazily and at
// most once a request (https://orpc.dev/docs/integrations/better-auth). A bearer that does not
// verify is refused, never retried as a cookie, and a cookie counts only on a request this site's
// own page made, which a browser marks and no other page can forge.

import { createAuth } from "../auth/auth";
import { createDb } from "../db/client";
import { verifyDeviceCredential } from "../device/device-auth";
import type { AppPrincipal } from "../library/library-principal";

const fromOwnPage = (request: Request): boolean =>
  request.headers.get("sec-fetch-site") === "same-origin";

const verifyPrincipal = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<AppPrincipal | null> => {
  const authorization = request.headers.get("authorization");
  if (authorization !== null) {
    const verified = await verifyDeviceCredential(createDb(env.DB), authorization);
    return verified === null
      ? null
      : {
          accountId: verified.userId,
          actor: { deviceId: verified.deviceId, deviceName: verified.deviceName, kind: "device" },
          scopes: ["library"],
        };
  }
  if (!fromOwnPage(request)) {
    return null;
  }
  const signedIn = await createAuth(env, ctx.exports, new URL(request.url).origin).api.getSession({
    headers: request.headers,
  });
  return signedIn === null
    ? null
    : {
        accountId: signedIn.user.id,
        actor: { kind: "session", sessionId: signedIn.session.id },
        scopes: ["library"],
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

// the window a principal's calls spend: its device's, or its browser session's
export const holderIdOf = (principal: AppPrincipal): string =>
  principal.actor.kind === "device" ? principal.actor.deviceId : principal.actor.sessionId;
