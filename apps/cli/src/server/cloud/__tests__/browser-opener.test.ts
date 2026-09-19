import { describe, expect, it } from "vitest";
import { resolveOpenCommand } from "../browser-opener";

const URL_WITH_QUERY =
  "https://provider.test/oauth/authorize?client_id=x&state=y&scope=read%20write";

describe("resolveOpenCommand", () => {
  it("hands the URL over as ONE argument, never as shell text", () => {
    expect(resolveOpenCommand("darwin", URL_WITH_QUERY)).toEqual({
      argv: [URL_WITH_QUERY],
      file: "open",
    });
    expect(resolveOpenCommand("linux", URL_WITH_QUERY)).toEqual({
      argv: [URL_WITH_QUERY],
      file: "xdg-open",
    });
  });

  it("opens on win32 through rundll32, not cmd, so the URL's `&` survives", () => {
    const command = resolveOpenCommand("win32", URL_WITH_QUERY);
    expect(command).toEqual({
      argv: ["url.dll,FileProtocolHandler", URL_WITH_QUERY],
      file: "rundll32",
    });
    expect(command?.argv.at(-1)).toBe(URL_WITH_QUERY);
    expect(command?.argv.some((arg) => arg === "start")).toBe(false);
  });

  it("has no opener for a platform it does not know", () => {
    expect(resolveOpenCommand("aix", URL_WITH_QUERY)).toBeNull();
  });
});
