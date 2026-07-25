// ---------------------------------------------------------------------------
// Structural guard on the ws host's remote-device gate.
//
// The allowlists themselves (REMOTE_ALLOWED_METHODS/_EVENTS) are only as good
// as the number of places that remember to consult them, and this transport has
// a track record: it shipped THREE separate ungated paths — the welcome
// hydration push, event broadcast, and binary frames — each found and patched
// individually, because every inbound/outbound path re-implemented "look up a
// handler" or "write to a socket" on its own.
//
// ws-host.ts now has exactly two chokepoints, resolveHandler() and sendEvent(),
// and this test is what keeps it at two. Behavioural tests can only cover the
// paths someone thought to write; this one fails when a FOURTH path appears,
// which is the actual failure mode.
//
// If you are here because this test failed: do not add your call site to an
// allowlist. Route it through resolveHandler/sendEvent — that is the fix.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WS_HOST = path.resolve(__dirname, "../ws-host.ts");
const source = fs.readFileSync(WS_HOST, "utf8");

/** Source lines with comments and the string-literal noise stripped, so a
 * mention in prose never counts as a call site. */
const codeLines = source
  .split("\n")
  .map((line) => line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, ""))
  .filter((line) => !/^\s*\*/.test(line));

function callSites(identifier: string): string[] {
  return codeLines.filter(
    (line) => line.includes(`${identifier}(`) && !line.includes(`function ${identifier}(`),
  );
}

describe("ws-host gate chokepoints", () => {
  it("resolves handlers in exactly one place", () => {
    // Reaching `dispatch` directly is how an inbound path skips the allowlist.
    const reads = codeLines.filter((line) => line.includes("dispatch.get("));
    expect(
      reads.map((line) => line.trim()),
      "dispatch.get() must only be called inside resolveHandler()",
    ).toHaveLength(1);
  });

  it("consults each allowlist in exactly one place", () => {
    // A second call site means a path decided to gate itself — which is the
    // pattern that produced three holes. One call site each = one chokepoint.
    expect(
      callSites("remoteMayInvoke").map((line) => line.trim()),
      "remoteMayInvoke() belongs to resolveHandler() alone",
    ).toHaveLength(1);
    expect(
      callSites("remoteMayReceive").map((line) => line.trim()),
      "remoteMayReceive() belongs to sendEvent() alone",
    ).toHaveLength(1);
  });

  it("fans out to authed sockets only through sendEvent", () => {
    // Loops over authedSockets that write frames must delegate; the two that
    // legitimately do something else are named here so a new one is visible.
    const NON_EVENT_LOOPS = [
      // Revocation closes sockets whose device the store no longer knows.
      "if (session.deviceId === LOCAL_DEVICE_ID) continue;",
    ];
    const loops = codeLines.filter((line) => line.includes("of authedSockets"));
    const ungated = loops.filter((line) => !line.includes("sendEvent("));

    for (const loop of ungated) {
      const index = codeLines.indexOf(loop);
      const body = codeLines.slice(index, index + 6).join("\n");
      const recognized = NON_EVENT_LOOPS.some((marker) => body.includes(marker));
      expect(
        recognized,
        `Loop over authedSockets that neither calls sendEvent() nor matches a known ` +
          `non-event loop — route pushes through sendEvent():\n${loop.trim()}`,
      ).toBe(true);
    }
  });

  it("keeps both chokepoints present and named", () => {
    // Cheap tripwire: a rename that split them would otherwise pass every
    // check above by making the identifiers disappear entirely.
    expect(source).toContain("function resolveHandler(");
    expect(source).toContain("function sendEvent(");
  });
});
