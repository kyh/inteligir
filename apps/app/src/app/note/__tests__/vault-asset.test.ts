import { describe, expect, it } from "vitest";
import { vaultAssetUrl } from "../vault-asset";

describe("vaultAssetUrl", () => {
  it("points a vault-relative path at the asset route", () => {
    expect(vaultAssetUrl("assets/diagram.png")).toBe(
      "/api/v1/vault/asset?path=assets%2Fdiagram.png",
    );
  });

  it("decodes the markdown URL before it becomes a vault path", () => {
    expect(vaultAssetUrl("assets/my%20picture.png")).toBe(
      "/api/v1/vault/asset?path=assets%2Fmy%20picture.png",
    );
  });

  it("treats a leading `./` and a leading `/` as vault-root spellings", () => {
    const expected = "/api/v1/vault/asset?path=assets%2Fa.png";
    expect(vaultAssetUrl("./assets/a.png")).toBe(expected);
    expect(vaultAssetUrl("/assets/a.png")).toBe(expected);
  });

  it("refuses traversal rather than sending it to be refused", () => {
    expect(vaultAssetUrl("../secrets.png")).toBeNull();
    expect(vaultAssetUrl("assets/../../secrets.png")).toBeNull();
    expect(vaultAssetUrl("..")).toBeNull();
  });

  it("refuses an empty path", () => {
    expect(vaultAssetUrl("")).toBeNull();
    expect(vaultAssetUrl("/")).toBeNull();
  });
});
