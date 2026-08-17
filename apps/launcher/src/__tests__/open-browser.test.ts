import { describe, expect, it } from "vitest";
import { resolveOpenCommand } from "../open-browser";

const URL_WITH_QUERY = "http://127.0.0.1:4664/?a=1&b=2";

describe("resolveOpenCommand", () => {
  it("uses `open` on macOS", () => {
    expect(resolveOpenCommand("darwin", URL_WITH_QUERY)).toEqual({
      file: "open",
      argv: [URL_WITH_QUERY],
    });
  });

  it("uses `xdg-open` on Linux", () => {
    expect(resolveOpenCommand("linux", URL_WITH_QUERY)).toEqual({
      file: "xdg-open",
      argv: [URL_WITH_QUERY],
    });
  });

  it("gives cmd's `start` an empty title so the URL is not read as one", () => {
    expect(resolveOpenCommand("win32", URL_WITH_QUERY)).toEqual({
      file: "cmd",
      argv: ["/c", "start", "", URL_WITH_QUERY],
    });
  });

  it("has no opener for a platform it does not know", () => {
    expect(resolveOpenCommand("aix", URL_WITH_QUERY)).toBeNull();
  });
});
