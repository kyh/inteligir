// ---------------------------------------------------------------------------
// Structural guard on the UserHost's capability gate.
//
// The gate itself (mayInvoke/mayReceive over a ClientClass) is only as good as
// the number of places that remember to consult it. Every inbound or outbound
// path that re-implements "look up a handler" or "write a frame to a socket" —
// the hydration push, event broadcast, binary frames — is a place that can
// forget, and a forgotten check fails OPEN: a client reaches a method or event
// its class never named.
//
// user-host.ts has exactly two chokepoints, resolveHandler() and sendEvent(),
// and this test is what keeps it at two. Behavioural tests can only cover the
// paths someone thought to write; this one fails when an extra path appears,
// which is the actual failure mode.
//
// If you are here because this test failed: do not add your call site to an
// allowlist. Route it through resolveHandler/sendEvent — that is the fix.
//
// The socket is no longer the only way in: the asset upload arrives as an HTTP
// request, reaches the same vault, and cannot pass through either chokepoint
// (there is no frame to resolve and no socket to push to). So it carries the
// gate itself, and the last case below is what keeps it carrying one — an HTTP
// route that reached a capability without naming it would be a hole no amount
// of care on the socket path could close.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import agentEndpointSource from "../host/agent-endpoints.ts?raw";
import assetSource from "../host/asset-route.ts?raw";
import source from "../host/user-host.ts?raw";

/** Source lines with comments stripped, so a mention in prose never counts as
 * a call site. */
const codeLines = source
  .split("\n")
  .map((line) => line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, ""))
  .filter((line) => !/^\s*\*/.test(line));

function callSites(identifier: string): string[] {
  return codeLines.filter(
    (line) => line.includes(`${identifier}(`) && !line.includes(`private ${identifier}(`),
  );
}

/** The loop line plus the lines that can plausibly be its body. */
function windowAt(line: string, lines: number): string {
  const index = codeLines.indexOf(line);
  return codeLines.slice(index, index + lines).join("\n");
}

describe("user-host gate chokepoints", () => {
  it("resolves handlers in exactly one place", () => {
    // Reaching the dispatch map directly is how an inbound path skips the gate.
    const reads = codeLines.filter((line) => line.includes("dispatch.get("));
    expect(
      reads.map((line) => line.trim()),
      "dispatch.get() must only be called inside resolveHandler()",
    ).toHaveLength(1);
  });

  it("consults each gate in exactly one place", () => {
    // A second call site means a path decided to gate itself — which is the
    // pattern that produces holes. One call site each = one chokepoint.
    expect(
      callSites("mayInvoke").map((line) => line.trim()),
      "mayInvoke() belongs to resolveHandler() alone",
    ).toHaveLength(1);
    expect(
      callSites("mayReceive").map((line) => line.trim()),
      "mayReceive() belongs to sendEvent() alone",
    ).toHaveLength(1);
  });

  it("fans out to authed sockets only through sendEvent", () => {
    const loops = codeLines.filter((line) => line.includes("of this.authedSockets()"));
    expect(loops.length, "no fan-out loop found — the broadcast shape changed").toBeGreaterThan(0);
    for (const loop of loops) {
      expect(
        windowAt(loop, 3),
        `Loop over authedSockets() that does not delegate to sendEvent() — route ` +
          `pushes through it:\n${loop.trim()}`,
      ).toContain("sendEvent(");
    }
  });

  it("writes frames to a socket only from the paths that own one", () => {
    // Exactly three writers, each named so a FOURTH is visible rather than
    // quietly correct-looking: sendEvent's own write (the push gate itself),
    // and two per-socket ANSWERS that are gated by something else — a res
    // frame by resolveHandler, the welcome frame by authentication itself.
    const OWNED_WRITES = [
      "WebSocket.READY_STATE_OPEN) ws.send(frame)",
      'ws.send(encodeFrame({ t: "res"',
      'ws.send(encodeFrame({ t: "welcome" }))',
    ];
    const writes = codeLines
      .filter((line) => /\bws\.send\(/.test(line))
      .filter((line) => !OWNED_WRITES.some((marker) => line.includes(marker)));

    expect(
      writes.map((line) => line.trim()),
      "A socket write outside sendEvent() and the two per-socket answers",
    ).toEqual([]);
  });

  it("gates the HTTP transport on the capability it serves", () => {
    // Named as the CHANNEL it stands in for, not as "an upload": the two are
    // the same capability over two transports, so they must be gated on the
    // same registry method or one of them will drift into a second policy.
    expect(assetSource).toContain('mayInvoke(SESSION_CLIENT_CLASS, "writeVaultAsset")');
  });

  it("gates the container's report on the token that names its generation", () => {
    // The report route is the third transport into this object and the widest:
    // everything downstream of it writes to the vault or runs a granted tool.
    // Its gate is NOT the client class — a container is not a client — so this
    // pins the two conditions it does carry, both required. A route that read a
    // report before proving whose container sent it would be a hole neither
    // socket chokepoint could close.
    expect(agentEndpointSource).toContain("readBearer(request.headers)");
    expect(agentEndpointSource).toContain("runner.acceptsReportToken(token)");
    // And the body is parsed only AFTER both, so an unauthenticated caller
    // cannot spend this object's time on a megabyte of JSON.
    const authIndex = agentEndpointSource.indexOf("acceptsReportToken");
    const parseIndex = agentEndpointSource.indexOf("await request.json()");
    expect(authIndex).toBeGreaterThan(-1);
    expect(parseIndex).toBeGreaterThan(authIndex);
  });

  it("keeps both chokepoints present and named", () => {
    // Cheap tripwire: a rename that split them would otherwise pass every check
    // above by making the identifiers disappear entirely.
    expect(source).toContain("private resolveHandler(");
    expect(source).toContain("private sendEvent(");
  });
});
