import { describe, expect, it } from "vitest";
import { VAULT_ASSET_MAX_BYTES as CLOUD_ASSET_MAX_BYTES } from "../../cloud/vault/vault-schema";
import { VAULT_ASSET_MAX_BYTES, vaultAssetWriteRequestSchema } from "../vault/vault-schema";

describe("the asset bound", () => {
  it("never exceeds the hosted route's own ceiling", () => {
    // Both routes serve the same vault, so a byte this host accepts and the
    // Worker refuses is an image that renders here and 404s on the phone.
    expect(VAULT_ASSET_MAX_BYTES).toBeLessThanOrEqual(CLOUD_ASSET_MAX_BYTES);
  });
});

describe("assetWrite", () => {
  it("holds `dir` to the vault path grammar", () => {
    expect(
      vaultAssetWriteRequestSchema.safeParse({
        dir: "../outside",
        baseName: "a.png",
        bytesBase64: "AA==",
      }).success,
    ).toBe(false);
    expect(
      vaultAssetWriteRequestSchema.safeParse({
        dir: "assets",
        baseName: "a.png",
        bytesBase64: "AA==",
      }).success,
    ).toBe(true);
  });
});
