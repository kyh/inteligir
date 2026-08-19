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

  it("gives cmd's `start` an empty title, so the URL is not read as one", () => {
    // `start` is a cmd builtin, so the executable is cmd — the closest a
    // no-shell rule gets on Windows.
    expect(resolveOpenCommand("win32", URL_WITH_QUERY)).toEqual({
      file: "cmd",
      argv: ["/c", "start", "", URL_WITH_QUERY],
    });
  });

  it("has no opener for a platform it does not know", () => {
    // Which is not a failure: the caller still answers the URL, and a pairing
    // completes from a link pasted anywhere.
    expect(resolveOpenCommand("aix", URL_WITH_QUERY)).toBeNull();
  });
});
