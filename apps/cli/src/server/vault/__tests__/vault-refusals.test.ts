// vaultWireError must carry the STATUS its contract row declares, not just the
// class. A custom class (INVALID_PATH) thrown with no status defaults to 500,
// and oRPC then refuses to mark it a defined error — so `isDefinedError` on the
// client silently misses it. Asserting `.code` alone is exactly what let that
// through, so these assert `.status` too.

import { VaultPathError } from "@repo/notes/knowledge/vault-path";
import { describe, expect, it } from "vitest";
import { INVALID_PATH } from "@repo/api/local/errors";
import { VaultServiceError } from "../vault-service";
import { vaultWireError } from "../vault-refusals";

describe("vaultWireError", () => {
  it("maps a filesystem path refusal to INVALID_PATH with the contract's status", () => {
    const error = vaultWireError(new VaultPathError("outside the vault"));
    expect(error?.code).toBe("INVALID_PATH");
    // The custom class must carry its declared status, or the client never sees
    // it as defined.
    expect(error?.status).toBe(INVALID_PATH.status);
  });

  it.each([
    ["not_found", "NOT_FOUND", 404],
    ["conflict", "CONFLICT", 409],
    ["too_large", "PAYLOAD_TOO_LARGE", 413],
  ] as const)("maps a %s service error to %s / %i", (code, wireClass, status) => {
    const error = vaultWireError(new VaultServiceError(code, "x"));
    expect(error?.code).toBe(wireClass);
    expect(error?.status).toBe(status);
  });

  it("returns null for anything it has no name for — a genuine 500", () => {
    expect(vaultWireError(new Error("boom"))).toBeNull();
  });
});
