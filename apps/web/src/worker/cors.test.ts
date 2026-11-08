import { EXTENSION_ORIGIN } from "@repo/contract/cloud/extension/extension-identity";
import { V1_SOCKET_PATH } from "@repo/contract/cloud/library/library-socket";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { buildHeaders, drained, ORIGIN } from "./test-support/cloud-helpers";

const SIGN_IN = `${ORIGIN}/v1/rpc/account/signIn`;

const preflight = async (url: string, origin: string): Promise<Response> =>
  await drained(
    exports.default.fetch(url, {
      headers: {
        "access-control-request-headers": "authorization, content-type, x-inteligir-build",
        "access-control-request-method": "POST",
        origin,
      },
      method: "OPTIONS",
    }),
  );

describe("the browser extension's cross-origin calls", () => {
  it("answers its service worker's preflight and lets it read a call's and a file's answer", async () => {
    const answered = await preflight(SIGN_IN, EXTENSION_ORIGIN);
    expect(answered.status).toBe(204);
    expect(answered.headers.get("access-control-allow-origin")).toBe(EXTENSION_ORIGIN);
    expect(answered.headers.get("access-control-allow-credentials")).toBeNull();
    for (const url of [SIGN_IN, `${ORIGIN}/v1/blobs/${"a".repeat(64)}`]) {
      const read = await drained(
        exports.default.fetch(url, {
          body: url === SIGN_IN ? JSON.stringify({ json: {} }) : null,
          headers: {
            ...buildHeaders(),
            "content-type": "application/json",
            origin: EXTENSION_ORIGIN,
          },
          method: url === SIGN_IN ? "POST" : "GET",
        }),
      );
      expect(read.headers.get("access-control-allow-origin"), url).toBe(EXTENSION_ORIGIN);
    }
  });

  it("answers no other origin, and no route the extension does not call", async () => {
    for (const [url, origin] of [
      [SIGN_IN, `${EXTENSION_ORIGIN}a`],
      [SIGN_IN, "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
      [SIGN_IN, "https://elsewhere.example"],
      // the Mac app's window is the site's own page, so Tauri's bundled origin is let in nowhere
      [SIGN_IN, "tauri://localhost"],
      [`${ORIGIN}/v1/blobs/${"a".repeat(64)}`, "tauri://localhost"],
      [`${ORIGIN}/api/auth/get-session`, EXTENSION_ORIGIN],
      [`${ORIGIN}${V1_SOCKET_PATH}`, EXTENSION_ORIGIN],
    ] as const) {
      const answered = await preflight(url, origin);
      expect(answered.headers.get("access-control-allow-origin"), `${origin} ${url}`).toBeNull();
    }
  });
});
