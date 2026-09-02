import { describe, expect, it } from "vitest";
import { resolveOpenCommand } from "../browser-opener";

const URL_WITH_QUERY = "https://cloud.test/app/pair?redirect=x&state=y&name=Work%20laptop";

describe("resolveOpenCommand", () => {
  it("hands the URL over as ONE argument, never as shell text", () => {
    expect(resolveOpenCommand("darwin", URL_WITH_QUERY)).toEqual({
      file: "open",
      argv: [URL_WITH_QUERY],
    });
    expect(resolveOpenCommand("linux", URL_WITH_QUERY)).toEqual({
      file: "xdg-open",
      argv: [URL_WITH_QUERY],
    });
  });

  it("opens on win32 through rundll32, not cmd, so the URL's `&` survives", () => {
    const command = resolveOpenCommand("win32", URL_WITH_QUERY);
    expect(command).toEqual({
      file: "rundll32",
      argv: ["url.dll,FileProtocolHandler", URL_WITH_QUERY],
    });
    expect(command?.argv.at(-1)).toBe(URL_WITH_QUERY);
    expect(command?.argv.some((arg) => arg === "start")).toBe(false);
  });

  it("has no opener for a platform it does not know", () => {
    expect(resolveOpenCommand("aix", URL_WITH_QUERY)).toBeNull();
  });
});
