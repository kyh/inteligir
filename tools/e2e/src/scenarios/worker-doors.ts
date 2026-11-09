import { once } from "node:events";
import { AUTH_API_PATHS } from "@repo/contract/account/account-schema";
import { clientBuildHeaders } from "@repo/contract/client-build";
import { CONNECTOR_PATH } from "@repo/contract/connector";
import { socketUrl } from "@repo/contract/library/account-socket";
import { V1_BLOBS_PATH } from "@repo/contract/library/library-blobs";
import {
  SOCKET_KEEPALIVE_PING,
  SOCKET_KEEPALIVE_PONG,
  V1_SOCKET_PATH,
} from "@repo/contract/library/library-socket";
import { V1_RPC_PATH } from "@repo/contract/v1";
import { expect, expectEq } from "../harness/assert";
import { PHONE_BUILD, signUp } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import type { Scenario } from "../harness/scenario";
import { asExtension, v1Client } from "../harness/v1-wire";
import { z } from "zod";

const SHA = "a".repeat(64);
const BUILD = clientBuildHeaders(PHONE_BUILD);

// a method each door's route does not take, and the door's own answer to it: a route that declared
// its methods instead would hand this one to the site's page, a 200 of HTML
const WRONG_METHODS = [
  { method: "PUT", path: "/api/auth/get-session", status: 404 },
  { method: "GET", path: AUTH_API_PATHS.signUp, status: 404 },
  { headers: BUILD, method: "GET", path: `${V1_RPC_PATH}/account/devices/list`, status: 404 },
  { headers: BUILD, method: "DELETE", path: `${V1_BLOBS_PATH}/${SHA}`, status: 405 },
  { method: "POST", path: V1_SOCKET_PATH, status: 400 },
  { method: "DELETE", path: CONNECTOR_PATH, status: 401 },
  { method: "POST", path: `/.well-known/oauth-protected-resource${CONNECTOR_PATH}`, status: 405 },
  { method: "POST", path: "/.well-known/oauth-authorization-server", status: 405 },
  { method: "GET", path: "/oauth/token", status: 405 },
  { method: "GET", path: "/oauth/register", status: 405 },
  { method: "PUT", path: "/connect/authorize", status: 405 },
] as const;

const SOCKET_DEADLINE_MS = 10_000;
const textFrameSchema = z.object({ data: z.string() });

// the account's socket opened on its ticket, through Start's route to the cell, and its answer to
// the keepalive the cell answers by auto-response
const socketAnswer = async (url: string): Promise<string> => {
  const socket = new WebSocket(url);
  const signal = AbortSignal.timeout(SOCKET_DEADLINE_MS);
  try {
    await once(socket, "open", { signal });
    const answered = once(socket, "message", { signal });
    socket.send(SOCKET_KEEPALIVE_PING);
    const events: unknown[] = await answered;
    return textFrameSchema.parse(events[0]).data;
  } finally {
    socket.close();
  }
};

export const workerDoors: Scenario = {
  description:
    "every door through the built Worker's Start routes: a method a door does not take answered by the door as it always was, never the site's page; an unknown /v1 or /api path a plain 404; and the account's socket upgraded through Start and answering",
  name: "worker-doors",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const worker = await ctx.cloudWorker();

    ctx.log("each door's route hands a method it does not take to its door");
    for (const { method, path, status, ...wrong } of WRONG_METHODS) {
      const headers = "headers" in wrong ? wrong.headers : {};
      const response = await fetch(`${worker.origin}${path}`, { headers, method });
      await response.arrayBuffer();
      expectEq(response.status, status, `${method} ${path}`);
      expect(
        response.headers.get("content-type")?.startsWith("text/html") !== true,
        `${method} ${path} answered the site's page`,
      );
    }

    ctx.log("a path under /v1 or /api that no door answers is a plain 404");
    for (const [method, path] of [
      ["GET", "/v1/nope"],
      ["POST", "/api/nope"],
    ] as const) {
      const response = await fetch(`${worker.origin}${path}`, { method });
      expectEq(
        [response.status, await response.text()],
        [404, "not found"],
        `${method} ${path} against the built bundle`,
      );
    }

    ctx.log("the account's socket upgrades through Start's route and answers");
    const site = await signUp(worker.origin);
    const { ticket } = await v1Client(worker, asExtension(site.cookie)).account.socketTicket();
    expectEq(
      await socketAnswer(socketUrl(worker.origin, ticket)),
      SOCKET_KEEPALIVE_PONG,
      "the socket's answer to its keepalive",
    );
  },
};
