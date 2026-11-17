// Who may call `/v1`, said once for the wire and a file's bytes alike: the build floor, the door
// the request came through, the session that door reads and the session's budget, in that order.
// A session is read by its door, each one a mark no other page can forge
// (https://orpc.dev/docs/integrations/better-auth):
//
// - a bearer is the browser extension's, the browser's own session cookie read from its jar. The
//   cookie beside it is never read, so a bearer that fails is refused, never retried as the
//   cookie.
// - a request the site's own page made, which a browser marks same-origin, a header no page script
//   can set and no install sends, is a tab's or the Mac app's window, on its cookie.
// - a request naming the phone's app scheme in `expo-origin` is the phone's, on the cookie it
//   keeps: a page cannot send that header without a preflight, which no route of the Worker's
//   answers.

import { PHONE_ORIGIN } from "@repo/contract/origin";
import {
  ClientOutdatedError,
  TooManyRequestsError,
  UnauthorizedError,
} from "@repo/contract/v1/errors";

import { readSession } from "../auth/auth";
import { buildFloor, isBelowFloor } from "../client-floor";
import type { AppPrincipal, SessionDoor } from "../library/library-principal";
import { spendCallBudget } from "../rate-limit";

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

type AdmissionRefusal = InstanceType<
  typeof ClientOutdatedError | typeof TooManyRequestsError | typeof UnauthorizedError
>;

type Admission =
  | { readonly kind: "admitted"; readonly principal: AppPrincipal }
  | { readonly kind: "refused"; readonly refusal: AdmissionRefusal };

// `limiter` is the family of calls the request is one of, whose minute its session spends
export const admit = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  limiter: RateLimit,
): Promise<Admission> => {
  // read for every request, so a floor that is no version faults them all alike
  const floor = buildFloor(env);
  const door = doorOf(request);
  // a page this Worker served ships in this deploy, so it is never below the floor
  if (door !== "page" && isBelowFloor(request, floor)) {
    return { kind: "refused", refusal: new ClientOutdatedError() };
  }
  const signedIn = door === null ? null : await readSession(env, ctx, request);
  if (door === null || signedIn === null) {
    return { kind: "refused", refusal: new UnauthorizedError() };
  }
  const sessionId = signedIn.session.id;
  if (!(await spendCallBudget(env, limiter, sessionId))) {
    return { kind: "refused", refusal: new TooManyRequestsError() };
  }
  return {
    kind: "admitted",
    principal: { accountId: signedIn.user.id, actor: { door, kind: "session", sessionId } },
  };
};
