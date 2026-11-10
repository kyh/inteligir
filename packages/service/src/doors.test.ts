// The doors as Start's routes hand them a request: each answers every method itself, only the paths
// its row of the table names, and a throw in its own protocol, logged.

import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DoorName } from "./doors-api";
import { doorsFor } from "./doors";
import { buildHeaders, drained, ORIGIN } from "./test-support/cloud-helpers";
import { workerFetch } from "./test-support/connector-session";

interface WrongMethod {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly withBuild?: true;
}

const SHA = "a".repeat(64);

// a method each door does not take, and what the door answered to it before Start served the doors
const WRONG_METHODS = {
  auth: { method: "PUT", path: "/api/auth/get-session", status: 404 },
  signUp: { method: "GET", path: "/api/sign-up", status: 404 },
  rpc: { method: "GET", path: "/v1/rpc/account/devices/list", status: 404, withBuild: true },
  blobs: { method: "DELETE", path: `/v1/blobs/${SHA}`, status: 405, withBuild: true },
  socket: { method: "POST", path: "/v1/socket", status: 400 },
  note: { method: "POST", path: "/v1/notes/0190a3f2-7c4e-7d1a-9b2c-3e4f5a6b7c8d", status: 400 },
  connector: { method: "DELETE", path: "/connector", status: 401 },
  connectorMetadata: {
    method: "POST",
    path: "/.well-known/oauth-protected-resource/connector",
    status: 405,
  },
  authorizationServerMetadata: {
    method: "POST",
    path: "/.well-known/oauth-authorization-server",
    status: 405,
  },
  oauthToken: { method: "GET", path: "/oauth/token", status: 405 },
  oauthRegister: { method: "GET", path: "/oauth/register", status: 405 },
  consent: { method: "PUT", path: "/connect/authorize", status: 405 },
} as const satisfies Record<DoorName, WrongMethod>;

// what Start's routes hand a door beyond its row: a splat's bare prefix, a trailing slash, another
// case
const BEYOND_ITS_ROW = [
  ["auth", "/api/auth"],
  ["rpc", "/v1/rpc"],
  ["blobs", "/v1/blobs"],
  ["socket", "/v1/socket/"],
  ["note", "/v1/notes"],
  ["connector", "/connector/"],
  ["consent", "/Connect/Authorize"],
] as const satisfies readonly (readonly [DoorName, string])[];

const answered = async (
  door: DoorName,
  request: Request,
  bindings: Env = env,
): Promise<Response> => {
  const ctx = createExecutionContext();
  const response = await doorsFor(bindings, ctx)[door](request);
  await waitOnExecutionContext(ctx);
  return response;
};

describe("the doors", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(Object.entries(WRONG_METHODS))(
    "%s answers a method it does not take as it always has",
    async (_door, { method, path, status, ...wrong }) => {
      const headers = "withBuild" in wrong ? buildHeaders() : {};
      const response = await drained(workerFetch(`${ORIGIN}${path}`, { headers, method }));
      expect(response.status).toBe(status);
    },
  );

  it.each(["/v1/nope", "/api/nope", "/v1/rpc", "/api/sign-up/"])(
    "answers %s, under a door's prefix but no door's, a plain 404",
    async (path) => {
      const response = await workerFetch(`${ORIGIN}${path}`, { method: "POST" });
      expect(response.status).toBe(404);
      await expect(response.text()).resolves.toBe("not found");
    },
  );

  it.each(BEYOND_ITS_ROW)(
    "the %s door refuses %s, which its row does not name",
    async (door, path) => {
      const response = await answered(door, new Request(`${ORIGIN}${path}`, { method: "POST" }));
      expect(response.status).toBe(404);
      await expect(response.text()).resolves.toBe("not found");
    },
  );

  it("answers a throw in the wire's own protocol, and every other door's as an internal error, logged", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    // a floor that is no version throws before any procedure reads the request; set past the type,
    // which is the config's one literal, as a deploy's own value would be
    const broken = Object.defineProperty({ ...env }, "MIN_CLIENT_BUILD", { value: "no-version" });
    const call = new Request(`${ORIGIN}/v1/rpc/account/devices/list`, {
      body: "{}",
      headers: { ...buildHeaders(), "content-type": "application/json" },
      method: "POST",
    });

    const rpc = await answered("rpc", call, broken);
    expect(rpc.status).toBe(500);
    await expect(rpc.json()).resolves.toMatchObject({
      json: { code: "INTERNAL_SERVER_ERROR", defined: false },
    });

    const blobs = await answered(
      "blobs",
      new Request(`${ORIGIN}/v1/blobs/${SHA}`, { headers: buildHeaders() }),
      broken,
    );
    expect(blobs.status).toBe(500);
    await expect(blobs.text()).resolves.toBe("internal error");

    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "unhandled-error",
        method: "POST",
        path: "/v1/rpc/account/devices/list",
      }),
    );
    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "unhandled-error",
        method: "GET",
        path: `/v1/blobs/${SHA}`,
      }),
    );
  });
});
