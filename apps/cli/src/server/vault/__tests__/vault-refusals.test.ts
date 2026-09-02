// oRPC v2 keeps no status on the error; asserting the class alone let a status bug through.

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
