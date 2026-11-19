import { clientBuildHeaders } from "@repo/contract/client-build";
import { PHONE_ORIGIN } from "@repo/contract/origin";
import { V1_RPC_PATH } from "@repo/contract/rpc/v1-contract";
import type { V1Client } from "@repo/contract/rpc/v1-contract";
import { isOrpcError } from "@repo/contract/rpc/v1-errors";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import { env } from "../env";
import { handleV1Rpc } from "../rpc/v1-rpc";
import { ORIGIN, sessionTokenOf } from "./auth-requests.test-utils";

const { major, minor, patch } = env.MIN_CLIENT_BUILD;

export const FLOOR_VERSION = `${String(major)}.${String(minor)}.${String(patch)}`;

export const buildHeaders = () =>
  clientBuildHeaders({ platform: "mobile", version: FLOOR_VERSION });

export const pageHeaders = (cookie: string) => ({
  cookie,
  origin: ORIGIN,
  "sec-fetch-site": "same-origin",
});

export const phoneHeaders = (cookie: string) => ({
  ...buildHeaders(),
  cookie,
  "expo-origin": PHONE_ORIGIN,
});

export const extensionHeaders = (cookie: string) => ({
  ...buildHeaders(),
  authorization: `Bearer ${sessionTokenOf(cookie)}`,
});

export const v1Post = async (
  path: string,
  headers: Record<string, string>,
  body: string = JSON.stringify({ json: {} }),
) =>
  await handleV1Rpc(
    new Request(`${ORIGIN}${V1_RPC_PATH}/${path}`, {
      body,
      headers: { ...headers, "content-type": "application/json" },
      method: "POST",
    }),
  );

interface Refusal {
  readonly code: string;
  readonly defined: boolean;
  readonly status: number | undefined;
}

export const v1Link = (headers: Record<string, string>) => {
  const statuses: number[] = [];

  const client = createORPCClient<V1Client>(
    new RPCLink({
      fetch: async (url, init) => {
        const response = await handleV1Rpc(new Request(url, init));
        statuses.push(response.status);

        return response;
      },
      headers,
      origin: ORIGIN,
      url: V1_RPC_PATH,
    }),
  );

  const refusalOf = async (call: Promise<unknown>) => {
    try {
      await call;
    } catch (error) {
      if (isOrpcError(error)) {
        return {
          code: error.code,
          defined: error.defined,
          status: statuses.at(-1),
        } satisfies Refusal;
      }

      throw error;
    }

    throw new Error("the call landed what the test expected it to refuse");
  };

  return { account: client.account, library: client.library, refusalOf };
};
