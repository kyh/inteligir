// The browser-facing half of browser-approve pairing (issue #573), driven
// through the COMPOSED app — because the things worth pinning here are the
// route's, not the runtime's: what a drive-by GET on a loopback route does,
// what address the redirect is aimed at, and what the browser is handed back.

import { statSync } from "node:fs";
import { PAIR_CALLBACK_PATH } from "@repo/cloud-contract/pairing";
import { describe, expect, it } from "vitest";
import { deviceCredentialPath } from "../credential-store";
import { pairCallbackUrlFor } from "../pair-callback";
import { bootTestApp, type BootedTestApp } from "../../__tests__/boot-app";
import { FakeCloud } from "./fake-cloud";

const LOOPBACK_HOST = "127.0.0.1:4664";
const CODE = "ABCD-EFGH";

async function boot(cloud: FakeCloud): Promise<BootedTestApp> {
  return await bootTestApp({
    cloudTransport: { fetch: cloud.fetch, pollIntervalMs: null },
    // The suite must never pop a window on whoever is running it — and the
    // begin route is asked for one below, so the seam has to be here.
    openExternalUrl: async () => true,
  });
}

async function begin(
  app: BootedTestApp,
  options: { host?: string; openBrowser?: boolean } = {},
): Promise<Response> {
  return await app.composed.app.request(`/api/v1/cloud/pair/begin`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: options.host ?? LOOPBACK_HOST,
    },
    body: JSON.stringify({ openBrowser: options.openBrowser ?? false }),
  });
}

function callbackFor(approveUrl: string, code: string, state: string): string {
  const approve = new URL(approveUrl);
  const callback = new URL(approve.searchParams.get("redirect") ?? "");
  callback.searchParams.set("code", code);
  callback.searchParams.set("state", state);
  return callback.toString();
}

/** The approve page's mint, bound to the PKCE challenge on the URL — so the
 *  callback's redeem finds a code whose challenge the app's verifier matches. */
function approveMint(cloud: FakeCloud, approveUrl: string, code: string): void {
  cloud.mintCode(code, new URL(approveUrl).searchParams.get("challenge") ?? "");
}

describe("where a pairing is told to come back to", () => {
  it("takes the port from the request, so a probed dev port still works", () => {
    expect(pairCallbackUrlFor("127.0.0.1:51000")).toBe(
      `http://127.0.0.1:51000${PAIR_CALLBACK_PATH}`,
    );
  });

  it("normalises localhost to the literal this process actually binds", () => {
    expect(pairCallbackUrlFor("localhost:4664")).toBe(`http://127.0.0.1:4664${PAIR_CALLBACK_PATH}`);
  });

  it("carries the default port through as the default port", () => {
    expect(pairCallbackUrlFor("127.0.0.1")).toBe(`http://127.0.0.1${PAIR_CALLBACK_PATH}`);
  });

  it("refuses a Host this app does not serve, however it is dressed", () => {
    for (const host of [
      undefined,
      "",
      "evil.example:4664",
      "127.0.0.1.evil.example:4664",
      "127.0.0.1:4664/../evil",
      "user@127.0.0.1:4664",
      "[::1]:4664",
    ]) {
      expect(pairCallbackUrlFor(host), String(host)).toBeNull();
    }
  });
});

describe("beginning a pairing", () => {
  it("refuses a request that did not arrive on this app's own address", async () => {
    const app = await boot(new FakeCloud());
    const response = await begin(app, { host: "evil.example" });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_request" });
  });
});

describe("the loopback callback", () => {
  it("pairs, at 0600, and consumes the state it used", async () => {
    const cloud = new FakeCloud();
    const app = await boot(cloud);

    const begun: unknown = await (await begin(app)).json();
    const url = typeof begun === "object" && begun !== null ? Reflect.get(begun, "url") : null;
    if (typeof url !== "string") throw new Error("begin answered no url");
    const state = new URL(url).searchParams.get("state") ?? "";
    approveMint(cloud, url, CODE);

    const landed = await app.composed.app.request(callbackFor(url, CODE, state));
    expect(landed.status).toBe(200);
    expect(landed.headers.get("content-type")).toBe("text/html; charset=utf-8");
    // The URL that reached this route carried a live pairing code.
    expect(landed.headers.get("cache-control")).toBe("no-store");
    expect(landed.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await landed.text()).toContain("Paired");

    const credentialPath = deviceCredentialPath(app.dataDir);
    expect(statSync(credentialPath).mode & 0o777).toBe(0o600);

    // The same link again — out of a history, out of a shoulder-surfed address
    // bar. The state was consumed, so it is no-pending before any redeem.
    const replay = await app.composed.app.request(callbackFor(url, CODE, state));
    expect(replay.status).toBe(400);
    expect(await replay.text()).toContain("Nothing to approve");
  });

  it("is inert for a drive-by with no approval armed, and says so", async () => {
    // Any page open in the user's browser can navigate at a loopback URL, and
    // this route deliberately carries no origin guard — the state is what
    // stands in its place, so with none armed nothing may happen.
    const cloud = new FakeCloud();
    const app = await boot(cloud);

    const bare = await app.composed.app.request(PAIR_CALLBACK_PATH);
    expect(bare.status).toBe(400);
    expect(await bare.text()).toContain("Nothing to approve");

    const guessed = await app.composed.app.request(
      `${PAIR_CALLBACK_PATH}?code=${CODE}&state=${"0".repeat(32)}`,
    );
    expect(guessed.status).toBe(400);
    expect(await guessed.text()).toContain("Nothing to approve");

    expect(cloud.requests).toEqual([]);
  });

  it("refuses a state that is not the one this app is waiting on", async () => {
    const cloud = new FakeCloud();
    const app = await boot(cloud);
    const begun: unknown = await (await begin(app)).json();
    const url = typeof begun === "object" && begun !== null ? Reflect.get(begun, "url") : null;
    if (typeof url !== "string") throw new Error("begin answered no url");

    const wrong = await app.composed.app.request(callbackFor(url, CODE, "f".repeat(32)));
    expect(wrong.status).toBe(400);
    expect(await wrong.text()).toContain("was for something else");
    expect(cloud.requests).toEqual([]);
  });
});
