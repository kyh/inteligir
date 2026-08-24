// The shell's other two security rules, beside the origin pin: WHERE the
// device token goes, and which files the bundle may answer with.

import { describe, expect, it } from "vitest";
import { RPC_PREFIX, VAULT_ASSET_PATH } from "@repo/api/local/routes";
import { bundleFile, isProxiedPath, socketCredentialFilter } from "../credential-scope";

describe("which paths carry the device token", () => {
  it("forwards the RPC handler and the asset route, and nothing else", () => {
    expect(isProxiedPath(`${RPC_PREFIX}/vault/read`)).toBe(true);
    expect(isProxiedPath(VAULT_ASSET_PATH)).toBe(true);
    expect(isProxiedPath("/")).toBe(false);
    expect(isProxiedPath("/assets/app-abc123.js")).toBe(false);
  });

  it("refuses a path that merely STARTS with the prefix", () => {
    // `/rpcx/...` is not the RPC handler, and forwarding it would hand a
    // credential to whatever answered.
    expect(isProxiedPath(`${RPC_PREFIX}x/steal`)).toBe(false);
    expect(isProxiedPath(RPC_PREFIX)).toBe(false);
    expect(isProxiedPath(`${VAULT_ASSET_PATH}x`)).toBe(false);
  });
});

describe("which files the bundle may answer with", () => {
  it("resolves a path inside the bundle", () => {
    expect(bundleFile("/app/renderer", "/assets/app.js")).toBe("/app/renderer/assets/app.js");
  });

  it("keeps traversal inside the bundle, encoded or not", () => {
    // A URL path is ABSOLUTE, so `normalize` drops the leading `..` segments
    // rather than climbing — and the encoded form decodes to the same thing
    // before containment is checked, which is why the check is on the RESOLVED
    // path and not on the URL.
    expect(bundleFile("/app/renderer", "/../../etc/passwd")).toBe("/app/renderer/etc/passwd");
    expect(bundleFile("/app/renderer", "/%2e%2e/%2e%2e/etc/passwd")).toBe(
      "/app/renderer/etc/passwd",
    );
  });

  it("refuses a path that resolves outside the bundle", () => {
    // The containment check is what makes the two cases above safe rather than
    // `normalize` being trusted to: a pathname that is not rooted DOES climb,
    // and this is the arm that catches it.
    expect(bundleFile("/app/renderer", "../renderer-evil/x.js")).toBeNull();
  });

  it("refuses an undecodable path rather than throwing", () => {
    // A lone `%` makes `decodeURIComponent` throw, and a throw inside the
    // protocol handler is a window that renders nothing.
    expect(bundleFile("/app/renderer", "/%")).toBeNull();
  });
});

describe("which requests get the bearer attached", () => {
  it("scopes the filter to this server's own websocket origin", () => {
    expect(socketCredentialFilter("http://127.0.0.1:4664")).toEqual(["ws://127.0.0.1:4664/*"]);
  });

  it("keeps the PORT, because a shared host is not an identity", () => {
    expect(socketCredentialFilter("http://127.0.0.1:23406")).toEqual(["ws://127.0.0.1:23406/*"]);
  });
});
