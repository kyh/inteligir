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
// So every module the Worker ships is swept, not a list of the files this guard
// happened to be pointed at — a list only ever sees the paths its author
// already thought of, which is precisely the module this is looking for. Each
// rule below is stated as the SET of files that may hold a fact; a file joining
// one is the failure, and the message names the fact rather than the line.
//
// If you are here because this failed: do not add your call site to the set.
// Route it through SocketGate — that is the fix.
//
// The socket is not the only way in. Several HTTP leaves reach the same vault
// and cannot pass through the gate (there is no frame to resolve and no socket
// to push to), so each carries the check itself, named as the registry METHOD
// it stands in for. That is a different fact from the socket chokepoint and is
// pinned as one.
//
// The COVERAGE is derived from `HOST_LEAVES` rather than listed, because a
// hand-written list is exactly what let a leaf ship ungated: adding a route
// there now fails this file until it is either gated or declared part of the
// socket path.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import { HOST_LEAVES, type HostLeaf } from "../host/host-route";

/**
 * Every module the Worker ships, keyed by its path under `src/worker/`.
 *
 * Vite resolves the glob at transform time, so the sweep needs no filesystem —
 * workerd has none, which is why this reads source as modules rather than
 * walking a tree. `__tests__` is excluded because a test's job is to spell what
 * production may not, and the two ambient `.d.ts` files because they are
 * generated declarations rather than code.
 */
const SOURCES = new Map(
  Object.entries(
    import.meta.glob(["../**/*.ts", "!../**/__tests__/**", "!../**/*.d.ts"], {
      query: "?raw",
      import: "default",
      eager: true,
    }),
  ).map(([key, source]): [string, string] => [key.replace(/^\.\.\//, ""), source]),
);

/** Source lines with comments stripped, so a mention in prose never counts as
 * a call site. */
function codeLines(source: string): string[] {
  return source
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, ""))
    .filter((line) => !/^\s*\*/.test(line));
}

const CODE = new Map(
  [...SOURCES].map(([file, source]): [string, string[]] => [file, codeLines(source)]),
);

/** A named module's code, or a loud failure — a file this guard cannot find is
 * a fact nothing checks. */
function linesOf(file: string): string[] {
  const lines = CODE.get(file);
  if (lines === undefined) {
    throw new Error(`src/worker/${file} is gone — re-anchor this guard, do not delete it`);
  }
  return lines;
}

/** Every module whose code matches, sorted — the set form each rule is stated
 * in. Patterns must be non-global: `test()` on a `/g` regex is stateful. */
function modulesMatching(pattern: RegExp): string[] {
  return [...CODE]
    .filter(([, lines]) => lines.some((line) => pattern.test(line)))
    .map(([file]) => file)
    .toSorted();
}

function callSites(lines: string[], identifier: string): string[] {
  return lines.filter((line) => line.includes(`${identifier}(`)).map((line) => line.trim());
}

/** Every line index whose text matches, so a window is anchored to the OCCURRENCE
 * rather than to the first line that happens to read the same. */
function indicesOf(lines: string[], needle: string): number[] {
  return lines.flatMap((line, index) => (line.includes(needle) ? [index] : []));
}

const GATE = "host/socket-gate.ts";
const TRANSPORT = "host/socket-transport.ts";

const gate = linesOf(GATE);

/**
 * The transports that reach a capability with no socket to gate them, each
 * named as the registry METHOD it stands in for.
 *
 * Naming the method is the point: an upload and `writeVaultAsset` are one
 * capability over two transports, so a route gated on something of its own
 * would be a second policy for the same thing — and the two would drift.
 */
/** The two leaves that ARE the socket path rather than a capability over a
 * second transport: the mint decides the class, and the upgrade carries it in
 * the attachment. Everything else must name the method it stands in for. */
const SOCKET_PATH_LEAVES = new Set<HostLeaf>(["ticket", "ws"]);

const HTTP_LEAVES = [
  {
    leaf: "assets" as HostLeaf,
    file: "host/asset-route.ts",
    gate: 'mayInvoke(clientClass, "writeVaultAsset")',
    why: "an upload too large for a frame is the write channel over a second transport",
  },
  {
    leaf: "link" as HostLeaf,
    file: "capture/deep-link-route.ts",
    gate: 'mayInvoke(clientClass, "ackCapture")',
    why: "a capture writes to the vault, so a class that may not ack one may not create one",
  },
  {
    leaf: "scripted" as HostLeaf,
    file: "host/scripted-route.ts",
    gate: 'mayInvoke(clientClass, "sendAgentCommand")',
    why:
      "seeding the scripted queue decides what the agent says next, which is " +
      "sendAgentCommand's outcome over a second transport",
  },
  {
    leaf: "export" as HostLeaf,
    file: "host/vault-export.ts",
    gate: 'mayInvoke("mobile", "readVaultFile")',
    why:
      "the download is a top-level navigation, so the cookie arrives with no Origin to " +
      "corroborate it and the gate names the class a bearer can at most amount to",
  },
];

describe("the gate has one way in and one way out", () => {
  it("gates every host leaf that is not the socket path itself", () => {
    const declared = new Set(HTTP_LEAVES.map((entry) => entry.leaf));
    const ungated = (Object.keys(HOST_LEAVES) as HostLeaf[]).filter(
      (leaf) => !SOCKET_PATH_LEAVES.has(leaf) && !declared.has(leaf),
    );
    expect(
      ungated,
      `a host leaf reaches a capability with no gate named for it: ${ungated.join(", ")}`,
    ).toEqual([]);
  });

  it("sweeps the whole Worker", () => {
    // A floor: a moved source tree or a glob that stops matching would make
    // every set below trivially satisfied.
    expect(SOURCES.size, "the sweep found almost nothing — did src/worker move?").toBeGreaterThan(
      50,
    );
  });

  it("lays hands on a socket in exactly one place", () => {
    // Upstream of every rule below: a module that cannot OBTAIN a socket cannot
    // write to one, whatever it does with the handler map.
    expect(
      modulesMatching(/\b(?:getWebSockets|acceptWebSocket)\(|\bnew WebSocketPair\b/),
      "sockets belong to SocketTransport — take them from it, do not enumerate your own",
    ).toEqual([TRANSPORT]);
  });

  it("names the handler map only where it is built, held, handed over or used", () => {
    // Built (handler-registry), assembled (host-composition), handed to the
    // transport (user-host), held and resolved (socket-transport, socket-gate).
    // A module outside this set naming it is a module that can dispatch a
    // method without the class gate ever answering.
    expect(
      modulesMatching(/\bHostHandlers\b|\bWireHandler\b|\.handlers\b/),
      "the handler map is SocketGate's — resolve through the gate instead of indexing it",
    ).toEqual([
      "host/handler-registry.ts",
      "host/host-composition.ts",
      GATE,
      TRANSPORT,
      "host/user-host.ts",
    ]);
  });

  it("resolves handlers in exactly one place", () => {
    // Reaching the dispatch map directly is how an inbound path skips the gate.
    expect(
      indicesOf(gate, "dispatch.get("),
      "dispatch.get() must only be called inside resolve()",
    ).toHaveLength(1);
  });

  it("consults each predicate in exactly one place on the socket path", () => {
    // A second call site inside the gate means a path decided to gate itself —
    // which is the pattern that produces holes. One call site each = one
    // chokepoint.
    expect(
      callSites(gate, "mayInvoke"),
      "mayInvoke() belongs to SocketGate.resolve() alone",
    ).toHaveLength(1);
    expect(
      callSites(gate, "mayReceive"),
      "mayReceive() belongs to SocketGate.push() alone",
    ).toHaveLength(1);

    // And nowhere else except where the predicates are declared and the leaves
    // below, which are the OTHER fact and are pinned as such.
    expect(
      modulesMatching(/\b(?:mayInvoke|mayReceive)\(/),
      "a capability check outside the socket gate and the three HTTP leaves — route\n" +
        "it through SocketGate, or add the leaf to HTTP_LEAVES with the method it stands for",
    ).toEqual(["host/client-class.ts", GATE, ...HTTP_LEAVES.map((leaf) => leaf.file)].toSorted());
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
    const OWNED_WRITES: Record<string, readonly string[]> = {
      [GATE]: ["WebSocket.READY_STATE_OPEN) socket.send(frame)"],
      [TRANSPORT]: ['ws.send(encodeFrame({ t: "res"', 'ws.send(encodeFrame({ t: "welcome" }))'],
    };
    // Receiver-shaped rather than a bare `.send(`: the Worker's other senders
    // are an email binding, the container port and a voice session, and a rule
    // that had to list them would rot the first time one was renamed.
    const SOCKET_WRITE = /\b[\w$]*(?:ws|sock(?:et)?)[\w$]*\.send\(/i;

    const writes = [...CODE].flatMap(([file, lines]) =>
      lines
        .filter((line) => SOCKET_WRITE.test(line))
        .filter((line) => !(OWNED_WRITES[file] ?? []).some((marker) => line.includes(marker)))
        .map((line) => `  ${file}: ${line.trim()}`),
    );

    expect(
      writes,
      `A socket write outside SocketGate.push() and the two per-socket answers:\n` +
        writes.join("\n"),
    ).toEqual([]);
  });

  it("gates each HTTP transport on the capability it serves", () => {
    for (const leaf of HTTP_LEAVES) {
      expect(
        linesOf(leaf.file).join("\n"),
        `${leaf.file} must gate on ${leaf.gate} — ${leaf.why}`,
      ).toContain(leaf.gate);
    }
  });

  it("gates the container's report on the token that names its generation", () => {
    // The report path is the third transport into this object and the widest:
    // everything downstream of it writes to the vault or runs a granted tool.
    // Its gate is NOT the client class — a container is not a client — and it
    // is not the route's either: the scripted container reaches the same entry
    // with no HTTP hop, so a decision the route made would be one that runtime
    // skipped. The HTTP leg reads the bearer and hands over; `acceptReport` is
    // where every condition is checked.
    const endpoints = linesOf("host/agent-endpoints.ts").join("\n");
    expect(endpoints).toContain("readBearer(request.headers)");
    expect(endpoints).toContain("runner.acceptReport(token,");
    expect(endpoints).not.toContain("AgentReportSchema");

    // The bearer answers WHICH LANE the container is, so the undo surface a
    // report's writes land under is read off the credential rather than taken
    // from the body — and it is derived in exactly ONE place, or the two
    // transports could disagree about whose container reported.
    const runner = linesOf("agent/agent-runner.ts");
    expect(callSites(runner, "this.resolveReportLane")).toHaveLength(1);
    const runnerSource = runner.join("\n");
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
    const gateSource = gate.join("\n");
    expect(gateSource).toContain("resolve(state: AuthedSocketState");
    expect(gateSource).toContain("private push(");
  });
});
