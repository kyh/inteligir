import { describe, expect, it } from "vitest";
import {
  MEDIA_TOKEN_PARAM,
  PAGE_COPY_PATH,
  pageCopyUrl,
  THUMB_WIDTHS,
  VAULT_ASSET_PATH,
  vaultAssetQuerySchema,
  vaultAssetUrl,
  VAULT_THUMB_PATH,
  vaultThumbQuerySchema,
  vaultThumbUrl,
} from "../local-routes";

const ORIGIN = "http://127.0.0.1:4711";

const query = (url: string): Record<string, string> =>
  Object.fromEntries(new URL(url).searchParams);

describe("a byte route's url", () => {
  it("names the path and the boot's media token, each encoded", () => {
    expect(vaultAssetUrl(ORIGIN, "media/α β.png", "tok/en")).toBe(
      `${ORIGIN}${VAULT_ASSET_PATH}?path=media%2F%CE%B1%20%CE%B2.png&${MEDIA_TOKEN_PARAM}=tok%2Fen`,
    );
    expect(pageCopyUrl(ORIGIN, "assets/pages/0a.html", "t")).toBe(
      `${ORIGIN}${PAGE_COPY_PATH}?path=assets%2Fpages%2F0a.html&m=t`,
    );
    expect(vaultThumbUrl(ORIGIN, "assets/a.png", THUMB_WIDTHS[1], "t")).toBe(
      `${ORIGIN}${VAULT_THUMB_PATH}?path=assets%2Fa.png&w=640&m=t`,
    );
  });

  it("reads back through its query schema", () => {
    expect(vaultAssetQuerySchema.parse(query(vaultAssetUrl(ORIGIN, "a.png", "t")))).toEqual({
      m: "t",
      path: "a.png",
    });
    expect(vaultThumbQuerySchema.parse(query(vaultThumbUrl(ORIGIN, "a.png", 320, "t")))).toEqual({
      m: "t",
      path: "a.png",
      w: "320",
    });
    expect(vaultThumbQuerySchema.safeParse({ path: "a.png", w: "100" }).success).toBe(false);
  });
});
