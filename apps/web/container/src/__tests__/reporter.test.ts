// ---------------------------------------------------------------------------
// The container's outbound half: the one thing in the image that speaks to the
// Worker.
//
// Two properties are load-bearing and neither is visible from the call sites:
// a report is attempted ONCE (a retried `events` batch is a duplicated
// assistant message in the user's chat), and the batches of one turn arrive in
// the order they were pushed. The third is the deadline, which is per KIND
// because a `tool` report is answered by a person.
// ---------------------------------------------------------------------------

import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { AGENT_CONFIRMATION_TIMEOUT_MS, reportTimeoutMs, type AgentReport } from "../protocol";
import { createEventStream, createReporter, resolveReportTarget } from "../reporter";

type Received = { readonly auth: string | null; readonly body: unknown };

/** A loopback stand-in for the report route, so `send` is driven over a real
 * request rather than a stubbed `fetch`. */
async function reportRoute(answer: (body: unknown) => { status: number; body: unknown }): Promise<{
  url: string;
  received: Received[];
  close: () => Promise<void>;
}> {
  const received: Received[] = [];
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      let body: unknown = null;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        body = null;
      }
      received.push({ auth: request.headers.authorization ?? null, body });
      const reply = answer(body);
      const payload = JSON.stringify(reply.body);
      response.writeHead(reply.status, { "content-type": "application/json" });
      response.end(payload);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return {
    url: `http://127.0.0.1:${address.port}/v1/agent/u/report`,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

let stop: (() => Promise<void>) | null = null;
afterEach(async () => {
  await stop?.();
  stop = null;
});

describe("the report deadline", () => {
  // The pair that must never disagree: a container that gave up at 30s while
  // the object waits 90s for a human would answer the model "the result is
  // unknown" and then have the confirmed delete happen anyway.
  it("outlives the human's confirmation window for a tool report", () => {
    expect(reportTimeoutMs("tool")).toBeGreaterThan(AGENT_CONFIRMATION_TIMEOUT_MS);
  });

  it("stays short for every report the object answers out of storage", () => {
    for (const kind of ["events", "vault", "turn_end"] satisfies AgentReport["kind"][]) {
      expect(reportTimeoutMs(kind)).toBeLessThan(AGENT_CONFIRMATION_TIMEOUT_MS);
    }
  });
});

describe("resolveReportTarget", () => {
  it("refuses a relative URL rather than dialing it", () => {
    expect(resolveReportTarget({ url: "/v1/agent/u/report", token: "t" })).toBe(null);
  });

  it("refuses a boot with no token", () => {
    expect(resolveReportTarget({ url: "https://host/report", token: "" })).toBe(null);
  });

  it("takes an absolute URL from the boot payload", () => {
    expect(resolveReportTarget({ url: "https://host/report", token: "t" })).toEqual({
      url: "https://host/report",
      token: "t",
    });
  });
});

describe("createReporter", () => {
  it("presents the boot's bearer and hands back the parsed reply", async () => {
    const route = await reportRoute(() => ({
      status: 200,
      body: { kind: "tool", isError: false, text: "found it" },
    }));
    stop = route.close;
    const reply = await createReporter({ url: route.url, token: "boot-token" }).send({
      kind: "tool",
      turnId: "t1",
      name: "search_vault",
      args: {},
    });
    expect(reply).toEqual({ kind: "tool", isError: false, text: "found it" });
    expect(route.received[0]?.auth).toBe("Bearer boot-token");
  });

  it("answers null for a refused report, and does NOT try again", async () => {
    const route = await reportRoute(() => ({ status: 500, body: { error: "no" } }));
    stop = route.close;
    const reply = await createReporter({ url: route.url, token: "t" }).send({
      kind: "events",
      turnId: "t1",
      events: [{ type: "agent_start" }],
    });
    expect(reply).toBe(null);
    // A retried batch is a duplicated assistant message in the user's chat.
    expect(route.received).toHaveLength(1);
  });

  it("reads a reply of an unknown shape as no reply at all", async () => {
    const route = await reportRoute(() => ({ status: 200, body: { kind: "something-else" } }));
    stop = route.close;
    const reply = await createReporter({ url: route.url, token: "t" }).send({
      kind: "vault",
      fromRevision: 0,
      ops: [],
    });
    expect(reply).toBe(null);
  });

  it("reads a vault reply, dropping any rejected entry that is not a string", async () => {
    const route = await reportRoute(() => ({
      status: 200,
      body: { kind: "vault", revision: 7, rejected: ["a.md: refused", 42] },
    }));
    stop = route.close;
    const reply = await createReporter({ url: route.url, token: "t" }).send({
      kind: "vault",
      fromRevision: 3,
      ops: [],
    });
    expect(reply).toEqual({ kind: "vault", revision: 7, rejected: ["a.md: refused"] });
  });
});

describe("the event stream", () => {
  it("delivers batches in the order they were pushed, one at a time", async () => {
    const inFlight: number[] = [];
    let concurrent = 0;
    const reporter = {
      send: async (report: AgentReport) => {
        concurrent += 1;
        inFlight.push(concurrent);
        await new Promise((resolve) => setTimeout(resolve, 5));
        concurrent -= 1;
        if (report.kind === "events") order.push(...report.events.map((e) => e.type));
        return null;
      },
    };
    const order: string[] = [];
    const stream = createEventStream(reporter, "turn-1");

    stream.push({ type: "one" });
    void stream.flush();
    stream.push({ type: "two" });
    await stream.flush();

    expect(order).toEqual(["one", "two"]);
    // Two batches in flight at once could arrive in either order, and the
    // object rebuilds a different conversation from them.
    expect(Math.max(...inFlight)).toBe(1);
  });

  it("flushes on its own once a batch is full", async () => {
    const sizes: number[] = [];
    const stream = createEventStream(
      {
        send: (report) => {
          if (report.kind === "events") sizes.push(report.events.length);
          return Promise.resolve(null);
        },
      },
      "turn-1",
    );
    for (let index = 0; index < 20; index += 1) stream.push({ type: `e${index}` });
    await stream.flush();
    expect(sizes).toEqual([20]);
  });
});
