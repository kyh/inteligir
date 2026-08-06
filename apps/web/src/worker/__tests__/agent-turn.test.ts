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
import type { FauxAgentScript } from "@repo/bridge/ipc-registry";

import type { FakeSandbox } from "../agent/fake-sandbox";
import type { UserHost } from "../host/user-host";
import { userHostName } from "../host/host-address";
import { SANDBOX_PROVIDER_ID } from "../agent/provider-catalog";

/** A fresh host object per case — the vault manifest, the transcript and the
 * scripted container all live in one object's storage. */
function withHost<T>(name: string, run: (host: UserHost) => Promise<T> | T): Promise<T> {
  const stub = env.UserHost.getByName(userHostName(name));
  return runInDurableObject(stub, (host) => run(host));
}

/** Select the credential-free provider — the cloud twin of the desktop's faux
 * agent: no account, no OAuth app, no container. */
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
  const existing = host.agent.scripted();
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
    const seen = await withHost("turn-events", async (host) => {
      const events: AppAgentEvent[] = [];
      connect(host);
      // The object's own bus is what a socket subscribes to, so listening here
      // is listening to exactly what a client would receive.
      const off = onAgentEvents(host, (event) => events.push(event));
      await host.agent.runner.send({ type: "user_message", text: "ping" });
      await settle();
      off();
      return events.map((event) => event.type);
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
      const scripted = host.agent.scripted();
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

/** Subscribe to the object's own event bus. Reaches through the host because
 * the bus is per-instance by design — a module-level one would fan a user's
 * events out to every other user's sockets. */
function onAgentEvents(host: UserHost, listener: (event: AppAgentEvent) => void): () => void {
  return hostEvents(host).onAny((method, payload) => {
    if (method === "onAgentEvent" && isAgentEvent(payload)) listener(payload);
  });
}

function hostEvents(host: UserHost): {
  onAny(listener: (method: string, payload: unknown) => void): () => void;
} {
  // The bus is private to the object; the composition hands the runner an
  // emitter over it, and this is the same subscription a socket makes.
  const candidate: unknown = Reflect.get(host, "events");
  if (
    typeof candidate === "object" &&
    candidate !== null &&
    "onAny" in candidate &&
    typeof candidate.onAny === "function"
  ) {
    const onAny = candidate.onAny.bind(candidate);
    return { onAny: (listener) => onAny(listener) };
  }
  throw new Error("the host's event bus is not reachable");
}

function isAgentEvent(payload: unknown): payload is AppAgentEvent {
  return typeof payload === "object" && payload !== null && "type" in payload;
}
