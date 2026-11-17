// `/v1/rpc` as each device calls it, handed to the handler apps/web mounts (../rpc/v1-rpc.ts): a
// link with the headers its door sends, and the status each answer came under.

import { clientBuildHeaders } from "@repo/contract/client-build";
import { PHONE_ORIGIN } from "@repo/contract/origin";
import { V1_RPC_PATH } from "@repo/contract/rpc/v1-contract";
import type { V1Client } from "@repo/contract/rpc/v1-contract";
import { isOrpcError } from "@repo/contract/rpc/v1-errors";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import { env } from "../env";
import { handleV1Rpc } from "../rpc/v1-rpc";
import { ORIGIN, sessionTokenOf } from "./auth-requests";

const { major, minor, patch } = env.MIN_CLIENT_BUILD;

export const FLOOR_VERSION = `${String(major)}.${String(minor)}.${String(patch)}`;

// an install at the floor
export const buildHeaders = (): Record<string, string> =>
  clientBuildHeaders({ platform: "mobile", version: FLOOR_VERSION });

// a tab or the Mac app's window on one of the site's own pages, which names no build
export const pageHeaders = (cookie: string) => ({
  cookie,
  origin: ORIGIN,
  "sec-fetch-site": "same-origin",
});

// the phone's runtime: its build, the cookie it keeps and its app scheme
export const phoneHeaders = (cookie: string) => ({
  ...buildHeaders(),
  cookie,
  "expo-origin": PHONE_ORIGIN,
});

// the browser extension: its build, and the browser's own session cookie as a bearer
export const extensionHeaders = (cookie: string) => ({
  ...buildHeaders(),
  authorization: `Bearer ${sessionTokenOf(cookie)}`,
});

// a raw call to a path below /v1/rpc, as no link would send it
export const v1Post = async (
  path: string,
  headers: Record<string, string>,
  body: string = JSON.stringify({ json: {} }),
): Promise<Response> =>
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
  // the refusal a call met, with the status it was answered under
  const refusalOf = async (call: Promise<unknown>): Promise<Refusal> => {
    try {
      await call;
    } catch (error) {
      if (isOrpcError(error)) {
        return { code: error.code, defined: error.defined, status: statuses.at(-1) };
      }
      throw error;
    }
    throw new Error("the call landed what the test expected it to refuse");
  };
  // the client is a proxy, so its routers are read off it rather than spread
  return { account: client.account, library: client.library, refusalOf };
};
