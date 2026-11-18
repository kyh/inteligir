// Who may call `/v1`, said once for the wire and a file's bytes alike: the build floor, the door the
// request came through, the session that door reads and the session's minute, in that order; a
// call and a file's read each spend a minute of their own. Each
// door is a mark no other page can forge (https://orpc.dev/docs/integrations/better-auth):
//
// - a bearer is the browser extension's, the browser's own session cookie read from its jar. The
//   cookie beside it is never read, so a bearer that fails is refused, never retried as the cookie.
// - a request the site's own page made, which a browser marks same-origin, a header no page script
//   can set and no install sends, is a tab's or the Mac app's window, on its cookie.
// - a request naming the phone's app scheme in `expo-origin` is the phone's, on the cookie it
//   keeps: a page cannot send that header without a preflight, which no route answers.

import {
  CLIENT_BUILD_HEADER,
  meetsBuildFloor,
  parseClientBuildHeader,
} from "@repo/contract/client-build";
import { PHONE_ORIGIN } from "@repo/contract/origin";
import { ClientOutdatedError, UnauthorizedError } from "@repo/contract/rpc/v1-errors";

import { readSession } from "../auth/auth";
import { env } from "../env";
import { spendHolderBudget } from "../rate-limit";
import type { HolderRateFamily } from "../rate-limit";
import type { RpcRefusal } from "./rpc-refusal";

export type SessionDoor = "page" | "phone" | "extension";

// one of Better Auth's sessions, whichever device signed it in
export interface AppPrincipal {
  readonly accountId: string;
  readonly actor: {
    readonly door: SessionDoor;
    readonly kind: "session";
    readonly sessionId: string;
  };
}

type Admission =
  | { readonly kind: "admitted"; readonly principal: AppPrincipal }
  | { readonly kind: "refused"; readonly refusal: RpcRefusal };

const doorOf = (headers: Headers): SessionDoor | null => {
  if (headers.has("authorization")) {
    return "extension";
  }
  if (headers.get("sec-fetch-site") === "same-origin") {
    return "page";
  }
  return headers.get("expo-origin") === PHONE_ORIGIN ? "phone" : null;
};

// a wire shape retires by raising the floor past every build that reads it; an absent or unreadable
// header is refused like a stale build, since every build that sends none is older than the floor
const isBelowFloor = (headers: Headers): boolean => {
  const build = parseClientBuildHeader(headers.get(CLIENT_BUILD_HEADER));
  return build === null || !meetsBuildFloor(build, env.MIN_CLIENT_BUILD);
};

export const admit = async (
  request: Request,
  budget: Extract<HolderRateFamily, "rpcCall" | "fileRead">,
): Promise<Admission> => {
  const { headers } = request;
  const door = doorOf(headers);
  // a page this deployment served ships in it, so it is never below the floor
  if (door !== "page" && isBelowFloor(headers)) {
    return { kind: "refused", refusal: new ClientOutdatedError() };
  }
  const signedIn = door === null ? null : await readSession(headers);
  if (door === null || signedIn === null) {
    return { kind: "refused", refusal: new UnauthorizedError() };
  }
  const sessionId = signedIn.session.id;
  const spent = await spendHolderBudget(budget, sessionId);
  if (spent.kind === "refused") {
    return { kind: "refused", refusal: { retryAfterSeconds: spent.retryAfterSeconds } };
  }
  return {
    kind: "admitted",
    principal: { accountId: signedIn.user.id, actor: { door, kind: "session", sessionId } },
  };
};
