import { MAC_APP_ORIGIN } from "@repo/contract/cloud/origin";
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

describe("the Mac page's cross-origin calls", () => {
  it("answers a preflight from the Mac page's origin with what its calls send, and no credentials", async () => {
    const answered = await preflight(SIGN_IN, MAC_APP_ORIGIN);
    expect(answered.status).toBe(204);
    expect(answered.headers.get("access-control-allow-origin")).toBe(MAC_APP_ORIGIN);
    expect(answered.headers.get("access-control-allow-credentials")).toBeNull();
    const allowed = (answered.headers.get("access-control-allow-headers") ?? "").split(", ");
    expect(allowed).toEqual(
      expect.arrayContaining(["authorization", "content-type", "x-inteligir-build"]),
    );
    expect(answered.headers.get("access-control-allow-methods")).toContain("PUT");
    expect(answered.headers.get("vary")).toContain("Origin");
  });

  it("lets the Mac page read an answer, a refusal included", async () => {
    const answered = await drained(
      exports.default.fetch(SIGN_IN, {
        body: JSON.stringify({ json: { deviceName: "Mac", email: "nobody@example.com" } }),
        headers: { ...buildHeaders(), "content-type": "application/json", origin: MAC_APP_ORIGIN },
        method: "POST",
      }),
    );
    expect(answered.status).toBe(400);
    expect(answered.headers.get("access-control-allow-origin")).toBe(MAC_APP_ORIGIN);
  });

  it("lets the Mac page read a file's answer", async () => {
    const answered = await drained(
      exports.default.fetch(`${ORIGIN}/v1/blobs/${"a".repeat(64)}`, {
        headers: { ...buildHeaders(), origin: MAC_APP_ORIGIN },
      }),
    );
    expect(answered.headers.get("access-control-allow-origin")).toBe(MAC_APP_ORIGIN);
  });

  it("answers no other origin, and no route the page does not call across origins", async () => {
    for (const [url, origin] of [
      [SIGN_IN, "https://elsewhere.example"],
      [SIGN_IN, "tauri://localhost.example"],
      [`${ORIGIN}/api/auth/get-session`, MAC_APP_ORIGIN],
      [`${ORIGIN}${V1_SOCKET_PATH}`, MAC_APP_ORIGIN],
    ] as const) {
      const answered = await preflight(url, origin);
      expect(answered.headers.get("access-control-allow-origin"), `${origin} ${url}`).toBeNull();
    }
  });
});
