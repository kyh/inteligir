// vaultWireError names the wire CLASS; the HTTP status a refusal answers comes
// from the shared map (oRPC v2 keeps none on the error). Both are pinned here so
// the class and its status cannot drift — asserting the class alone is what let
// a status bug through before.

import { VaultPathError } from "@repo/notes/knowledge/vault-path";
import { describe, expect, it } from "vitest";
import { VaultServiceError } from "../vault-service";
import { vaultRefusalStatus, vaultWireError } from "../vault-refusals";

describe("vaultWireError", () => {
  it("maps a filesystem path refusal to the INVALID_PATH class, which answers 400", () => {
    const cause = new VaultPathError("outside the vault");
    expect(vaultWireError(cause)?.code).toBe("INVALID_PATH");
    expect(vaultRefusalStatus(cause)).toBe(400);
  });

  it.each([
    ["not_found", "NOT_FOUND", 404],
    ["conflict", "CONFLICT", 409],
    ["too_large", "PAYLOAD_TOO_LARGE", 413],
  ] as const)("maps a %s service error to %s / %i", (code, wireClass, status) => {
    const cause = new VaultServiceError(code, "x");
    expect(vaultWireError(cause)?.code).toBe(wireClass);
    expect(vaultRefusalStatus(cause)).toBe(status);
  });

  it("returns null for anything it has no name for — a genuine 500", () => {
    expect(vaultWireError(new Error("boom"))).toBeNull();
    expect(vaultRefusalStatus(new Error("boom"))).toBeNull();
  });
});
