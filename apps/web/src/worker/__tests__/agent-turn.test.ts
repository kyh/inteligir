// ---------------------------------------------------------------------------
// A whole agent turn, over the scripted container.
//
// The point of these suites is that almost nothing here is a double. The
// runner, the transcript, the tool executor, the confirmation broker, the vault
// write-back and the event broadcast are the production ones, reached through
// the production report path; the only fake is the process that would have
// produced the reports (../agent/fake-sandbox). So a turn driven here exercises
// the same code a container would drive, minus the HTTP hop and pi.
//
// Everything runs INSIDE the Durable Object: a `SqlStorage` handle is bound to
// the object's I/O context and cannot be used once it has been handed back out.
// ---------------------------------------------------------------------------

import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { AppAgentEvent } from "@repo/bridge/agent-events";
import type { FauxAgentScript } from "@repo/bridge/agent-script";
import { parseServerFrame } from "@repo/bridge/ws-protocol";
import { CONTAINER_REFUSAL } from "@repo/agent-container/protocol";

import type { FakeSandbox } from "../agent/fake-sandbox";
import type { UserHost } from "../host/user-host";
import { userHostName } from "../host/host-address";
import { authedState, writeSocketState } from "../host/socket-state";
import { SANDBOX_PROVIDER_ID } from "../agent/provider-catalog";

/** A fresh host object per case — the vault manifest, the transcript and the
 * scripted container all live in one object's storage. */
function withHost<T>(
  name: string,
  run: (host: UserHost, ctx: DurableObjectState) => Promise<T> | T,
): Promise<T> {
  const stub = env.UserHost.getByName(userHostName(name));
  return runInDurableObject(stub, (host, ctx) => run(host, ctx));
}

/** Select the credential-free provider: no account, no OAuth app, no
 * container. */
function connect(host: UserHost): void {
  host.agent.credentials.setSelection({ provider: SANDBOX_PROVIDER_ID, modelId: "sandbox-1" });
}

/** Drive one turn to completion. The scripted container defers its work through
 * `ctx.waitUntil`, so the turn continues after `send` resolves. */
async function turn(host: UserHost, text: string, script: FauxAgentScript["steps"]): Promise<void> {
  connect(host);
  scriptedPort(host).setScript({ steps: script });
  await host.agent.runner.send({ type: "user_message", text });
  await settle();
}

function scriptedPort(host: UserHost): FakeSandbox {
  const existing = host.agent.scripted("chat");
  if (existing === null) throw new Error("this deployment is not running the scripted container");
  return existing;
}

/** Let every deferred continuation run. */
async function settle(): Promise<void> {
  for (let pass = 0; pass < 50; pass += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let pass = 0; pass < 50; pass += 1) await Promise.resolve();
}

describe("an agent turn", () => {
  it("records the user's message and the assistant's answer in the transcript", async () => {
    const entries = await withHost("turn-basic", async (host) => {
      // The port has to exist before it can be scripted, and it is built on the
      // first `sandbox()` call — which `send` makes.
      connect(host);
      await host.agent.runner.send({ type: "user_message", text: "hello" });
      await settle();
      return host.agent.chat.history();
    });
    expect(entries.map((entry) => entry.role)).toEqual(["user", "assistant"]);
    expect(entries[0]?.text).toBe("hello");
    expect(entries[1]?.text).toBe("[scripted] hello");
  });

  it("refuses a turn when no provider is connected", async () => {
    await withHost("turn-unconnected", async (host) => {
      await expect(host.agent.runner.send({ type: "user_message", text: "hi" })).rejects.toThrow(
        /Settings → AI/,
      );
    });
  });

  it("broadcasts every agent event it records", async () => {
    const seen = await withHost("turn-events", async (host, ctx) => {
      connect(host);
      const client = attachClient(ctx);
      await host.agent.runner.send({ type: "user_message", text: "ping" });
      await settle();
      return client.agentEvents().map((event) => event.type);
    });
    expect(seen).toContain("agent_start");
    expect(seen).toContain("message_end");
    expect(seen).toContain("agent_end");
  });

  it("materializes the vault into the container before dispatching", async () => {
    const held = await withHost("turn-vault", async (host) => {
      await host.vault.writeText("notes/one.md", "# One\n");
      await host.vault.writeText("notes/two.md", "# Two\n");
      await turn(host, "look around", [{ text: "done" }]);
      const scripted = host.agent.scripted("chat");
      return scripted === null ? [] : [...scripted.materialized().keys()].toSorted();
    });
    // AGENTS.md is seeded on first connect, not here, so the vault is exactly
    // what this case wrote.
    expect(held).toEqual(["notes/one.md", "notes/two.md"]);
  });

  it("pushes only what changed to a container that is already warm", async () => {
    const pushes = await withHost("turn-delta", async (host) => {
      connect(host);
      await host.vault.writeText("first.md", "# First\n");
      await host.agent.runner.send({ type: "user_message", text: "one" });
      await settle();
      const cold = scriptedPort(host).lastPush();
      await host.vault.writeText("second.md", "# Second\n");
      await host.agent.runner.send({ type: "user_message", text: "two" });
      await settle();
      return { cold, warm: scriptedPort(host).lastPush() };
    });
    expect(pushes.cold?.replaceAll).toBe(true);
    expect(pushes.cold?.upserted.map((file) => file.path)).toEqual(["first.md"]);
    // A warm container keeps its filesystem, so the second wake sends the delta
    // rather than the whole manifest — the change log's whole reason to exist.
    expect(pushes.warm?.replaceAll).toBe(false);
    expect(pushes.warm?.upserted.map((file) => file.path)).toEqual(["second.md"]);
  });

  it("does not re-seed a container that already holds the conversation", async () => {
    const seeds = await withHost("turn-seed", async (host) => {
      const observed: number[] = [];
      connect(host);
      await host.agent.runner.send({ type: "user_message", text: "first" });
      await settle();
      observed.push(host.agent.chat.history().length);
      await host.agent.runner.send({ type: "user_message", text: "second" });
      await settle();
      observed.push(host.agent.chat.history().length);
      return observed;
    });
    // Two complete turns: user + assistant, twice. A re-seeded session would
    // have replayed the first turn as new transcript entries.
    expect(seeds).toEqual([2, 4]);
  });

  // The whole point of the port having a return direction: ONE turn, from the
  // dispatch through the container's work, its reports, the vault of record and
  // the fan-out to sockets, with nothing between them stubbed. The lane is what
  // holds it together — every report here is authenticated with the scripted
  // container's own boot bearer, and the sink derives "chat" from it. Break
  // that derivation and this goes red in three places at once: an unattended
  // report writes nothing (no background run holds the lane), records nothing
  // in the conversation, and captures nothing under the chat undo surface.
  it("carries one turn from dispatch through the vault of record to the sockets", async () => {
    const outcome = await withHost("turn-round-trip", async (host, ctx) => {
      await host.vault.writeText("notes/searchable.md", "# Findable\n\nunmistakable-token\n");
      connect(host);
      const client = attachClient(ctx);
      scriptedPort(host).setScript({
        steps: [
          {
            text: "Found it and wrote it down.",
            toolCalls: [{ name: "search_vault", arguments: { query: "unmistakable-token" } }],
            writes: [{ path: "notes/from-the-agent.md", text: "# From the agent\n" }],
          },
        ],
      });

      await host.agent.runner.send({ type: "user_message", text: "note what you find" });
      await settle();
      const events = client.agentEvents();
      return {
        events: events.map((event) => event.type),
        toolResult: events.find((event) => event.type === "tool_execution_end"),
        history: host.agent.chat.history().map((entry) => ({ role: entry.role, text: entry.text })),
        written: await host.vault.readText("notes/from-the-agent.md"),
        // The container adopted the revision the object answered with, so its
        // own bytes are not pushed back at it on the next wake.
        container: await scriptedPort(host).state(),
        revision: host.agent.revisions.current(),
        notice: scriptedPort(host).lastVaultNotice(),
        broadcast: [...new Set(client.channels())].toSorted(),
        busy: host.agent.runner.agentBusy(),
      };
    });

    // Container work: the tool ran host-side and answered with real rows.
    expect(outcome.toolResult).toMatchObject({ type: "tool_execution_end", isError: false });
    expect(JSON.stringify(outcome.toolResult)).toContain("notes/searchable.md");
    // The turn's shape, as a socket saw it.
    expect(outcome.events).toEqual([
      "agent_start",
      "tool_execution_start",
      "tool_execution_end",
      "message_start",
      "message_end",
      "agent_end",
    ]);
    // The conversation of record.
    expect(outcome.history).toEqual([
      { role: "user", text: "note what you find" },
      { role: "tool", text: expect.stringContaining("notes/searchable.md") },
      { role: "assistant", text: "Found it and wrote it down." },
    ]);
    // The vault of record — not the container's copy.
    expect(outcome.written).toBe("# From the agent\n");
    expect(outcome.notice).toBe("");
    expect(outcome.container.phase === "ready" && outcome.container.vaultRevision).toBe(
      outcome.revision,
    );
    // The fan-out: the write's undo point is announced on the CHAT surface,
    // which is the lane made visible.
    expect(outcome.broadcast).toContain("onAgentEditCaptured");
    expect(outcome.broadcast).toContain("onAgentEvent");
    expect(outcome.broadcast).toContain("onVaultChanged");
    expect(outcome.busy).toBe(false);
  });

  // A reported removal is refused (deletion is the destructive tier's), and the
  // refusal has to reach the MODEL — the agent's own file tools already told it
  // the file was gone. The image steers that sentence into the running session;
  // this asserts the sentence was produced at all.
  it("tells the container what the vault of record refused", async () => {
    const refused = await withHost("turn-refused-write", async (host) => {
      connect(host);
      scriptedPort(host).setScript({
        steps: [{ text: "Saved.", writes: [{ path: "notes/held.md", text: "# Held\n" }] }],
      });
      // No restore point can be made for a path whose bytes are unreachable,
      // and a write with no undo point is refused, fail-closed.
      await host.vault.writeText("notes/held.md", "# Original\n");
      const file = host.vault.lookup("notes/held.md");
      if (file === null) throw new Error("the target was not written");
      await env.VAULT_FILES.delete(`${userHostName("turn-refused-write")}/${file.key}`);

      await host.agent.runner.send({ type: "user_message", text: "save it" });
      await settle();
      return {
        notice: scriptedPort(host).lastVaultNotice(),
        container: await scriptedPort(host).state(),
        revision: host.agent.revisions.current(),
      };
    });
    expect(refused.notice).toContain("notes/held.md");
    expect(refused.notice).toContain("restore point");
    // Nothing was applied, so the container may not move past its own baseline.
    expect(refused.container.phase === "ready" && refused.container.vaultRevision).toBe(
      refused.revision,
    );
  });

  // `steer` and `follow_up` take no turn of their own: they fold into the loop
  // already running and keep reporting under ITS id. A container that refused
  // every concurrent dispatch made that unreachable from a test.
  it("folds a steer into the turn already running", async () => {
    const turn = await withHost("turn-steer", async (host, ctx) => {
      connect(host);
      const client = attachClient(ctx);
      scriptedPort(host).setScript({ steps: [{ text: "first" }, { text: "and second" }] });

      await host.agent.runner.send({ type: "user_message", text: "start" });
      // `send` resolves when the container ACCEPTS, and the container clears
      // `busy` only after three more reports — so a dispatch here is mid-turn.
      // Captured rather than assumed: if the turn had already ended, the steer
      // would open a second one and the `agent_start` count below says so.
      const midTurn = await scriptedPort(host).state();
      const busyMidTurn = midTurn.phase === "ready" && midTurn.busy;
      await host.agent.runner.send({ type: "steer", text: "and this too" });
      await settle();
      const events = client.agentEvents();
      return {
        busyMidTurn,
        starts: events.filter((event) => event.type === "agent_start").length,
        said: events.flatMap((event) =>
          event.type === "message_end" && event.role === "assistant" ? [event.text] : [],
        ),
      };
    });
    expect(turn.busyMidTurn).toBe(true);
    // ONE turn, two things said in it.
    expect(turn.starts).toBe(1);
    expect(turn.said).toEqual(["first", "and second"]);
  });

  // Two `user_message`s is two turns, and there is only ever one. Both
  // containers answer that with the SAME sentence, out of the contract they
  // share — the alternative is a status code in the user's composer.
  it("refuses a second message while a turn is running, in the container's words", async () => {
    const refusal = await withHost("turn-busy", async (host) => {
      connect(host);
      await host.agent.runner.send({ type: "user_message", text: "first" });
      return await host.agent.runner
        .send({ type: "user_message", text: "second" })
        .then(() => "")
        .catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
    });
    expect(refusal).toBe(CONTAINER_REFUSAL.turnInFlight);
  });

  it("rolls a fresh thread and leaves the old one browsable", async () => {
    const { sessions, history } = await withHost("turn-sessions", async (host) => {
      connect(host);
      await host.agent.runner.send({ type: "user_message", text: "old thread" });
      await settle();
      host.agent.runner.newSession();
      await host.agent.runner.send({ type: "user_message", text: "new thread" });
      await settle();
      return { sessions: host.agent.chat.sessions(), history: host.agent.chat.history() };
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.title).toBe("old thread");
    expect(history.map((entry) => entry.text)).toEqual(["new thread", "[scripted] new thread"]);
  });
});

/**
 * An authenticated socket on this object, and what it was pushed.
 *
 * There is no seam to subscribe to instead, and that is deliberate: the object
 * announces straight into the capability gate, which writes frames to the
 * sockets `ctx.getWebSockets()` holds. So a listener IS a socket — accepted the
 * way the upgrade accepts one, with the attachment a spent ticket would have
 * written — and every assertion below is on bytes that crossed the gate.
 */
function attachClient(ctx: DurableObjectState): {
  channels: () => string[];
  agentEvents: () => AppAgentEvent[];
} {
  const pair = new WebSocketPair();
  const [client, server] = [pair[0], pair[1]];
  ctx.acceptWebSocket(server, ["v1"]);
  writeSocketState(server, authedState("web", Date.now()));
  const pushed: Array<{ method: string; payload: unknown }> = [];
  client.accept();
  client.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    const frame = parseServerFrame(event.data);
    if (frame !== null && frame.t === "evt") {
      pushed.push({ method: frame.method, payload: frame.payload });
    }
  });
  return {
    channels: () => pushed.map((frame) => frame.method),
    agentEvents: () =>
      pushed.flatMap((frame) =>
        frame.method === "onAgentEvent" && isAgentEvent(frame.payload) ? [frame.payload] : [],
      ),
  };
}

function isAgentEvent(payload: unknown): payload is AppAgentEvent {
  return typeof payload === "object" && payload !== null && "type" in payload;
}
