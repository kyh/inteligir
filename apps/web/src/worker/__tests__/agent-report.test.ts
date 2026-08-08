// ---------------------------------------------------------------------------
// The report path — the only way anything the container produces becomes real.
//
// Two things are under test and they pull in opposite directions. The route has
// to be reachable by a caller with NO user session, because a container does not
// have one; and it must not be reachable by anything else, because everything
// downstream of it writes to the user's vault.
//
// The third case is the one worth reading: a container-side `rm` is REFUSED. The
// grant table puts deletion in the destructive tier where a human answers first,
// so a host that applied a reported removal would be performing the same effect
// with nobody asked — and `bash rm` inside the container would silently become
// a vault delete.
// ---------------------------------------------------------------------------

import { env, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { bytesToBase64 } from "@repo/agent-container/protocol";

import { mintScopedToken } from "../agent/agent-crypto";
import { matchAgentReportPath } from "../agent/agent-route";
import { SANDBOX_PROVIDER_ID } from "../agent/provider-catalog";
import { userHostName } from "../host/host-address";
import type { UserHost } from "../host/user-host";

const ORIGIN = "https://inteligir-web.workers.dev";

function withHost<T>(name: string, run: (host: UserHost) => Promise<T> | T): Promise<T> {
  return runInDurableObject(env.UserHost.getByName(userHostName(name)), (host) => run(host));
}

/**
 * A bearer that is valid for `userId`'s CURRENT container generation — which
 * means booting one first, because the boot id is what the token is bound to —
 * and the turn id that container is running, because a report naming any other
 * turn folds into nothing.
 */
async function liveContainer(
  host: UserHost,
  userId: string,
): Promise<{ token: string; turnId: string }> {
  host.agent.credentials.setSelection({ provider: SANDBOX_PROVIDER_ID, modelId: "sandbox-1" });
  await host.agent.runner.send({ type: "user_message", text: "wake up" });
  const scripted = host.agent.scripted("chat");
  if (scripted === null) throw new Error("this deployment is not running the scripted container");
  const state = await scripted.state();
  if (state.phase !== "ready") throw new Error("the scripted container did not boot");
  const token = await mintScopedToken(env.BETTER_AUTH_SECRET, {
    scope: "report",
    userId,
    ref: state.bootId,
    expiresAt: Date.now() + 60_000,
  });
  return { token, turnId: host.agent.runner.chatTurnId() };
}

function report(userId: string, token: string | null, body: unknown): Promise<Response> {
  const headers = new Headers({ "content-type": "application/json" });
  if (token !== null) headers.set("authorization", `Bearer ${token}`);
  return SELF.fetch(`${ORIGIN}/v1/agent/${encodeURIComponent(userId)}/report`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("the container report route", () => {
  it("addresses only its own path shape", () => {
    expect(matchAgentReportPath("POST", "/v1/agent/user-a/report")).toBe("user-a");
    expect(matchAgentReportPath("GET", "/v1/agent/user-a/report")).toBeNull();
    expect(matchAgentReportPath("POST", "/v1/agent/user-a/reports")).toBeNull();
    expect(matchAgentReportPath("POST", "/v1/agent//report")).toBeNull();
  });

  it("refuses a report with no bearer", async () => {
    const response = await report("report-user", null, { kind: "events", turnId: "t", events: [] });
    expect(response.status).toBe(401);
  });

  it("refuses a bearer minted for another account", async () => {
    const foreign = await mintScopedToken(env.BETTER_AUTH_SECRET, {
      scope: "report",
      userId: "someone-else",
      ref: "boot-1",
      expiresAt: Date.now() + 60_000,
    });
    // The path and the token disagree, so nothing is even woken.
    const response = await report("report-user", foreign, {
      kind: "events",
      turnId: "t",
      events: [],
    });
    expect(response.status).toBe(401);
  });

  it("refuses a bearer from a container that was replaced", async () => {
    const stale = await mintScopedToken(env.BETTER_AUTH_SECRET, {
      scope: "report",
      userId: "report-stale",
      ref: "a-boot-that-never-happened",
      expiresAt: Date.now() + 60_000,
    });
    const response = await report("report-stale", stale, {
      kind: "events",
      turnId: "t",
      events: [],
    });
    expect(response.status).toBe(401);
  });

  // The body ceiling is what stops a container — a process the user's own
  // agent runs shell commands inside — spending a Durable Object's memory. A
  // declared content-length is the ordinary case and NOT the dangerous one: a
  // chunked body declares nothing, so a ceiling that only reads the header is
  // no ceiling at all.
  it("refuses an oversized body that declares no length", async () => {
    const userId = "report-huge";
    const token = await mintScopedToken(env.BETTER_AUTH_SECRET, {
      scope: "report",
      userId,
      ref: "a-boot",
      expiresAt: Date.now() + 60_000,
    });
    const megabyte = new Uint8Array(1024 * 1024).fill(0x61);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(megabyte);
      },
    });
    const response = await SELF.fetch(`${ORIGIN}/v1/agent/${userId}/report`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      // No content-length: a streamed body declares nothing, which is exactly
      // the shape the header check cannot bound.
      body,
    });
    // 413 rather than the 401 this token would eventually earn: the ceiling
    // holds before an object is woken, which is the whole point of it.
    expect(response.status).toBe(413);
  });

  it("refuses a body that is not a report", async () => {
    const userId = "report-shape";
    const live = await withHost(userId, (host) => liveContainer(host, userId));
    const response = await report(userId, live.token, { kind: "nonsense" });
    expect(response.status).toBe(400);
  });

  it("writes the agent's file edits into the vault of record", async () => {
    const userId = "report-write";
    const live = await withHost(userId, (host) => liveContainer(host, userId));
    const response = await report(userId, live.token, {
      kind: "vault",
      fromRevision: 0,
      ops: [
        {
          op: "upsert",
          path: "notes/from-agent.md",
          bytesBase64: bytesToBase64(new TextEncoder().encode("# Written by the agent\n")),
        },
      ],
    });
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ kind: "vault", rejected: [] });
    const stored = await withHost(userId, (host) => host.vault.readText("notes/from-agent.md"));
    expect(stored).toBe("# Written by the agent\n");
  });

  it("refuses a reported removal and says which tool to use instead", async () => {
    const userId = "report-remove";
    const live = await withHost(userId, async (host) => {
      await host.vault.writeText("keep.md", "still here\n");
      return liveContainer(host, userId);
    });
    const response = await report(userId, live.token, {
      kind: "vault",
      fromRevision: 0,
      ops: [{ op: "remove", path: "keep.md" }],
    });
    const body: unknown = await response.json();
    expect(body).toMatchObject({ rejected: [expect.stringContaining("delete_note")] });
    const state = await withHost(userId, (host) => host.vault.lookup("keep.md")?.state);
    expect(state).toBe("live");
  });

  // The container's `./vault` is a COPY, and this number is how it knows how
  // far behind the record it is. Answering `current()` unconditionally would
  // have it claim a revision covering a browser edit it never received — and
  // the delta on the next wake would then skip that file forever.
  it("lets the container adopt a revision only its own writes moved", async () => {
    const userId = "report-revision";
    const live = await withHost(userId, (host) => liveContainer(host, userId));
    const first = await report(userId, live.token, {
      kind: "vault",
      fromRevision: 0,
      ops: [
        {
          op: "upsert",
          path: "notes/agent.md",
          bytesBase64: bytesToBase64(new TextEncoder().encode("# one\n")),
        },
      ],
    });
    const advanced = (await first.json()) as { revision: number };
    expect(advanced.revision).toBeGreaterThan(0);

    // A browser edit lands while the turn is still running, so the container's
    // baseline is no longer the vault's.
    await withHost(userId, (host) => host.vault.writeText("notes/theirs.md", "# theirs\n"));
    const second = await report(userId, live.token, {
      kind: "vault",
      fromRevision: advanced.revision,
      ops: [
        {
          op: "upsert",
          path: "notes/agent.md",
          bytesBase64: bytesToBase64(new TextEncoder().encode("# two\n")),
        },
      ],
    });
    expect(await second.json()).toMatchObject({ revision: advanced.revision });
  });

  // A container outlives a turn, so a `turn_end` it re-sends for one that is
  // long over must not clear `busy` under the turn now running.
  it("folds a report for another turn into nothing", async () => {
    const userId = "report-stale-turn";
    const live = await withHost(userId, (host) => liveContainer(host, userId));

    const tool = await report(userId, live.token, {
      kind: "tool",
      turnId: "a-turn-that-is-over",
      name: "search_vault",
      args: { query: "anything" },
    });
    expect(await tool.json()).toMatchObject({ kind: "tool", isError: true });

    const busy = await withHost(userId, async (host) => {
      // The live container says it has started work on the turn this host
      // dispatched; the one that is over then announces its end.
      const turnId = host.agent.runner.chatTurnId();
      await host.agent.runner.report(
        { kind: "events", turnId, events: [{ type: "agent_start" }] },
        "chat",
      );
      await host.agent.runner.report(
        { kind: "turn_end", turnId: "a-turn-that-is-over", error: null },
        "chat",
      );
      return host.agent.runner.agentBusy();
    });
    expect(busy).toBe(true);
  });

  it("runs a tool call and answers with its result", async () => {
    const userId = "report-tool";
    const live = await withHost(userId, async (host) => {
      await host.vault.writeText("notes/searchable.md", "# Findable\n\nunmistakable-token\n");
      return liveContainer(host, userId);
    });
    const response = await report(userId, live.token, {
      kind: "tool",
      turnId: live.turnId,
      name: "search_vault",
      args: { query: "unmistakable-token" },
    });
    const body: unknown = await response.json();
    expect(body).toMatchObject({ kind: "tool", isError: false });
    expect(JSON.stringify(body)).toContain("notes/searchable.md");
  });
});
