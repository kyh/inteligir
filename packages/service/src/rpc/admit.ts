import {
  CLIENT_BUILD_HEADER,
  meetsBuildFloor,
  parseClientBuildHeader,
} from "@repo/contract/client-build";
import { PHONE_ORIGIN } from "@repo/contract/origin";
import {
  ClientOutdatedError,
  TooManyRequestsError,
  UnauthorizedError,
} from "@repo/contract/rpc/v1-errors";

import { readSession } from "../auth/auth";
import { env } from "../env";
import { spendHolderBudget } from "../rate-limit";
import type { HolderRateFamily } from "../rate-limit";
import type { RpcRefusal } from "./rpc-refusal";

export type SessionDoor = "page" | "phone" | "extension";

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

const doorOf = (headers: Headers) => {
  if (headers.has("authorization")) {
    return "extension" as const;
  }

  if (headers.get("sec-fetch-site") === "same-origin") {
    return "page" as const;
  }

  return (
    headers.get("expo-origin") === PHONE_ORIGIN ? "phone" : null
  ) satisfies SessionDoor | null;
};

const isBelowFloor = (headers: Headers) => {
  const build = parseClientBuildHeader(headers.get(CLIENT_BUILD_HEADER));

  return build === null || !meetsBuildFloor(build, env.MIN_CLIENT_BUILD);
};

export const admit = async (
  request: Request,
  budget: Extract<HolderRateFamily, "rpcCall" | "fileRead">,
) => {
  const { headers } = request;
  const door = doorOf(headers);

  if (door !== "page" && isBelowFloor(headers)) {
    return { kind: "refused", refusal: new ClientOutdatedError() } satisfies Admission;
  }

  const signedIn = door === null ? null : await readSession(headers);

  if (door === null || signedIn === null) {
    return { kind: "refused", refusal: new UnauthorizedError() } satisfies Admission;
  }

  const sessionId = signedIn.session.id;
  const spent = await spendHolderBudget(budget, sessionId);

  if (spent.kind === "refused") {
    const { retryAfterSeconds } = spent;

    return {
      kind: "refused",
      refusal: new TooManyRequestsError({ data: { retryAfterSeconds } }),
    } satisfies Admission;
  }

  return {
    kind: "admitted",
    principal: { accountId: signedIn.user.id, actor: { door, kind: "session", sessionId } },
  } satisfies Admission;
};
