// ---------------------------------------------------------------------------
// Structural backstop on the host's capability gate.
//
// The gate's BEHAVIOUR is asserted where it lives — socket-gate.test.ts drives
// both directions through a fake socket, and inverting either predicate turns
// that file red. This one covers the failure a behavioural test cannot see: a
// path someone ADDS that re-implements "look up a handler" or "write a frame to
// a socket" and forgets to consult the gate. A forgotten check fails OPEN, and
// no test written before that path existed would notice.
//
// If you are here because this failed: do not add your call site to an
// allowlist. Route it through SocketGate — that is the fix.
//
// The socket is not the only way in: the asset upload arrives as an HTTP
// request, reaches the same vault, and cannot pass through the gate (there is
// no frame to resolve and no socket to push to). So it carries the check
// itself, and the case below is what keeps it carrying one — an HTTP route that
// reached a capability without naming it would be a hole no amount of care on
// the socket path could close.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import agentEndpointSource from "../host/agent-endpoints.ts?raw";
import assetSource from "../host/asset-route.ts?raw";
import gateSource from "../host/socket-gate.ts?raw";
import runnerSource from "../agent/agent-runner.ts?raw";
import hostSource from "../host/user-host.ts?raw";

/** Source lines with comments stripped, so a mention in prose never counts as
 * a call site. */
function codeLines(source: string): string[] {
  return source
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, ""))
    .filter((line) => !/^\s*\*/.test(line));
}

const gate = codeLines(gateSource);
const host = codeLines(hostSource);

function callSites(lines: string[], identifier: string): string[] {
  return lines
    .filter((line) => line.includes(`${identifier}(`) && !line.includes(`${identifier}(\n`))
    .map((line) => line.trim());
}

/** Every line index whose text matches, so a window is anchored to the OCCURRENCE
 * rather than to the first line that happens to read the same. */
function indicesOf(lines: string[], needle: string): number[] {
  return lines.flatMap((line, index) => (line.includes(needle) ? [index] : []));
}

/** The same call-site scan over the runner — where the report path's own gate
 * lives. */
function runnerCallSites(identifier: string): string[] {
  return codeLines(runnerSource).filter((line) => line.includes(`${identifier}(`));
}

describe("the gate has one way in and one way out", () => {
  it("resolves handlers in exactly one place", () => {
    // Reaching the dispatch map directly is how an inbound path skips the gate.
    expect(
      indicesOf(gate, "dispatch.get("),
      "dispatch.get() must only be called inside resolve()",
    ).toHaveLength(1);
    expect(indicesOf(host, "dispatch.get("), "the dispatch map belongs to SocketGate").toEqual([]);
  });

  it("consults each predicate in exactly one place", () => {
    // A second call site means a path decided to gate itself — which is the
    // pattern that produces holes. One call site each = one chokepoint.
    expect(
      callSites(gate, "mayInvoke"),
      "mayInvoke() belongs to SocketGate.resolve() alone",
    ).toHaveLength(1);
    expect(
      callSites(gate, "mayReceive"),
      "mayReceive() belongs to SocketGate.push() alone",
    ).toHaveLength(1);
    for (const predicate of ["mayInvoke", "mayReceive"]) {
      expect(
        callSites(host, predicate),
        `${predicate}() outside the gate — route the call through SocketGate`,
      ).toEqual([]);
    }
  });

  it("fans out to sockets only through the push gate", () => {
    const loops = indicesOf(gate, "of this.sockets()");
    expect(loops.length, "no fan-out loop found — the broadcast shape changed").toBeGreaterThan(0);
    for (const index of loops) {
      // Anchored to THIS loop's own index: locating a window by matching text
      // would validate two identical loops against the first one's body.
      expect(
        gate.slice(index, index + 4).join("\n"),
        `Loop over sockets() that does not delegate to push() — route the writes ` +
          `through it:\n${gate[index]?.trim() ?? ""}`,
      ).toContain("this.push(");
    }
  });

  it("writes frames to a socket only from the paths that own one", () => {
    // Exactly three writers, each named so a FOURTH is visible rather than
    // quietly correct-looking: the gate's own write (the push gate itself), and
    // two per-socket ANSWERS gated by something else — a res frame by
    // resolve(), the welcome frame by authentication itself.
    const OWNED_WRITES = [
      "WebSocket.READY_STATE_OPEN) socket.send(frame)",
      'ws.send(encodeFrame({ t: "res"',
      'ws.send(encodeFrame({ t: "welcome" }))',
    ];
    const writes = [...gate, ...host]
      .filter((line) => /\b(?:ws|socket)\.send\(/.test(line))
      .filter((line) => !OWNED_WRITES.some((marker) => line.includes(marker)));

    expect(
      writes.map((line) => line.trim()),
      "A socket write outside SocketGate.push() and the two per-socket answers",
    ).toEqual([]);
  });

  it("gates the HTTP transport on the capability it serves", () => {
    // Named as the CHANNEL it stands in for, not as "an upload": the two are
    // the same capability over two transports, so they must be gated on the
    // same registry method or one of them will drift into a second policy.
    expect(assetSource).toContain('mayInvoke(clientClass, "writeVaultAsset")');
  });

  it("gates the container's report on the token that names its generation", () => {
    // The report path is the third transport into this object and the widest:
    // everything downstream of it writes to the vault or runs a granted tool.
    // Its gate is NOT the client class — a container is not a client — and it
    // is not the route's either: the scripted container reaches the same entry
    // with no HTTP hop, so a decision the route made would be one that runtime
    // skipped. The HTTP leg reads the bearer and hands over; `acceptReport` is
    // where every condition is checked.
    expect(agentEndpointSource).toContain("readBearer(request.headers)");
    expect(agentEndpointSource).toContain("runner.acceptReport(token,");
    expect(agentEndpointSource).not.toContain("AgentReportSchema");

    // The bearer answers WHICH LANE the container is, so the undo surface a
    // report's writes land under is read off the credential rather than taken
    // from the body — and it is derived in exactly ONE place, or the two
    // transports could disagree about whose container reported.
    expect(runnerCallSites("this.resolveReportLane")).toHaveLength(1);
    expect(runnerSource).toContain("private async resolveReportLane(");
    expect(runnerSource).toContain("private report(");

    // And the body is parsed only AFTER the identity holds, so a caller who
    // cannot prove which container it is never spends this object's time on a
    // megabyte of JSON.
    const authIndex = runnerSource.indexOf("this.resolveReportLane(identity)");
    const parseIndex = runnerSource.indexOf("JSON.parse(body)");
    expect(authIndex).toBeGreaterThan(-1);
    expect(parseIndex).toBeGreaterThan(authIndex);
  });

  it("keeps both chokepoints present and named", () => {
    // Cheap tripwire: a rename that split them would otherwise pass every check
    // above by making the identifiers disappear entirely.
    expect(gateSource).toContain("resolve(state: AuthedSocketState");
    expect(gateSource).toContain("private push(");
  });
});
