// The opener's PURE half. Its other half spawns a process, which is exactly
// what a test must not do — so what is pinned here is the argv, which is the
// property that matters: an argv list is what keeps this off a shell.

import { describe, expect, it } from "vitest";
import { resolveOpenCommand } from "../browser-opener";

const URL_WITH_QUERY = "https://cloud.test/app/pair?redirect=x&state=y&name=Work%20laptop";

describe("resolveOpenCommand", () => {
  it("hands the URL over as ONE argument, never as shell text", () => {
    // The URL carries `&` and `%20`; a shell would split on the first and a
    // quoting scheme would have to be right about the second.
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
    // cmd.exe re-parses `&` as a command separator even with shell:false, so
    // `cmd /c start` would open a truncated URL and could run the tail as a
    // command. rundll32's protocol handler takes the whole URL through
    // CreateProcess with no cmd in the path.
    const command = resolveOpenCommand("win32", URL_WITH_QUERY);
    expect(command).toEqual({
      file: "rundll32",
      argv: ["url.dll,FileProtocolHandler", URL_WITH_QUERY],
    });
    // The `&`-bearing query reaches the handler whole — nothing split it off.
    expect(command?.argv.at(-1)).toBe(URL_WITH_QUERY);
    expect(command?.argv.some((arg) => arg === "start")).toBe(false);
  });

  it("has no opener for a platform it does not know", () => {
    // Which is not a failure: the caller still answers the URL, and a pairing
    // completes from a link pasted anywhere.
    expect(resolveOpenCommand("aix", URL_WITH_QUERY)).toBeNull();
  });
});
