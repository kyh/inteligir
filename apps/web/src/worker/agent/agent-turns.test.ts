// The built-in agent's turns in the account's cell, over the fake Managed Agents API, whose turns
// really call this Worker's connector with the token the account's vault holds: a turn's writes
// land in its one change set, its events are stored once and relayed, sends wait their turn, an
// approval waits on the person or on ten minutes, a cancel denies and then interrupts, a spent
// allowance stops a thread and refuses a send, and an Anthropic that does not answer charges
// nothing.

import { createRouterClient } from "@orpc/server";
import { runDurableObjectAlarm } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { runPlan } from "@repo/notes/library/library-sql";
import { readItem, writeMeta } from "@repo/notes/library/library-queries";

import type { LandingScope } from "../library/cell-landing";
import { cellStorageOf } from "../library/cell-storage";
import { libraryRouter } from "../library/library-router";
import { cellActorOf } from "../library/library-principal";
import { agentOn, storedTypes, threadStatus, turnOpen, valueOf } from "../test-support/agent-turns";
import type { AgentUnderTest } from "../test-support/agent-turns";
import {
  cellOf,
  inCell,
  landedValue,
  noteFields,
  paragraph,
  placed,
  SYSTEM,
} from "../test-support/library-cell";
import {
  fakeManagedAgentsApi,
  servedAgents,
  serveInProcess,
} from "../test-support/managed-agents-api";
import { deleteAgentThread, cancelTurn, respondToAgent, sendToAgent } from "./agent-turns";
import { nextDayAt } from "./agent-allowance";
import { openTurn } from "./turn-rows";

const setSchema = z.object({
  actor: z.string(),
  id: z.string(),
  label: z.string(),
  sealed_at: z.number().nullable(),
});

const agentSets = (state: DurableObjectState) =>
  state.storage.sql
    .exec("SELECT id, actor, label, sealed_at FROM change_sets WHERE actor = 'agent'")
    .toArray()
    .map((row) => setSchema.parse(row));

const eventJsonSchema = z.object({ json: z.string() });

// a thread's stored events of `type`, as the cell kept them
const storedOf = (state: DurableObjectState, threadId: string, type: string) =>
  state.storage.sql
    .exec(
      "SELECT json FROM thread_events WHERE thread_id = ? AND type = ? ORDER BY idx",
      threadId,
      type,
    )
    .toArray()
    .map((row) => z.json().parse(JSON.parse(eventJsonSchema.parse(row).json)));

const usageSchema = z.object({ cost_cents: z.number(), turns: z.number() });

const usageToday = (state: DurableObjectState) => {
  const [row] = state.storage.sql.exec("SELECT turns, cost_cents FROM agent_usage").toArray();
  return row === undefined ? { cost_cents: 0, turns: 0 } : usageSchema.parse(row);
};

// a note in the library, for the agent to act on
const noteIn = (agent: AgentUnderTest, title: string): string => {
  const id = crypto.randomUUID();
  landedValue(
    agent.cell.library.create(SYSTEM, {
      blocks: placed([paragraph("a", `${title}, as written.`)]),
      fields: noteFields({ title }),
      id,
    }),
  );
  return id;
};

// whether the item sits in Deleted
const isDeleted = (state: DurableObjectState, itemId: string): boolean => {
  const item = runPlan(cellStorageOf(state.storage), readItem(itemId));
  return item?.kind === "live" && item.fields.deletedAt !== null;
};

const pendingOf = (agent: AgentUnderTest): readonly string[] =>
  valueOf(agent.cell.library.read(openTurn))?.pending ?? [];

// the account's library as the apps call it, by a laptop of its own
const appClient = (agent: AgentUnderTest) =>
  createRouterClient(libraryRouter, {
    context: {
      actor: () =>
        cellActorOf({
          accountId: agent.cell.accountId,
          actor: { deviceId: "laptop-1", deviceName: "Laptop", kind: "device" },
          scopes: ["library"],
        }),
      agent: agent.cell,
      library: agent.cell.library,
      settle: async (result) => await Promise.resolve(result),
    },
  });

const refusalOf = async (call: Promise<unknown>) => {
  try {
    await call;
  } catch (error) {
    return error;
  }
  throw new Error("the call was answered");
};

describe("the built-in agent's turns", () => {
  it(
    "runs a turn whose writes land in one undoable change set, its events stored once and relayed",
    { timeout: 30_000 },
    async () => {
      await inCell(cellOf(), async (state) => {
        const agent = await agentOn(state);
        const sent = valueOf(
          await sendToAgent(agent.cell, {
            text: 'File this.\ncall create_note {"markdown":"Paris is the capital."}',
          }),
        );
        expect(sent.status).toBe("running");
        await agent.settled();
        expect(turnOpen(state)).toBe(false);
        expect(threadStatus(state, sent.threadId)).toBe("idle");
        expect(storedTypes(state, sent.threadId)).toEqual([
          "user.message",
          "agent.mcp_tool_use",
          "agent.mcp_tool_result",
          "agent.message",
          "session.usage",
          "session.status_idle",
        ]);
        // each stored event relayed once it was, the agent's message previewed before it
        const relayed = agent.frames.flatMap((frame) =>
          frame.type === "thread" && !frame.preview ? [frame.event] : [],
        );
        expect(relayed).toHaveLength(6);
        const previews = agent.frames.filter((frame) => frame.type === "thread" && frame.preview);
        expect(previews.length).toBeGreaterThan(0);
        // the turn's one change set, sealed, by the agent, holding the note it made
        const [set] = agentSets(state);
        expect(agentSets(state)).toHaveLength(1);
        expect(set).toMatchObject({ label: "Agent" });
        expect(set?.sealed_at).not.toBeNull();
        const library = appClient(agent);
        const { items } = await library.items.list({});
        expect(items).toHaveLength(1);
        await library.history.undo({ changeSetIds: [set?.id ?? ""] });
        const undone = await library.items.list({});
        expect(undone.items).toHaveLength(0);
        // the turn, counted once, and its session's list cost
        expect(usageToday(state)).toEqual({ cost_cents: 2, turns: 1 });
      });
    },
  );

  it(
    "says the view context and the filing rules beside the person's words, each where it belongs",
    { timeout: 30_000 },
    async () => {
      await inCell(cellOf(), async (state) => {
        const agent = await agentOn(state);
        const itemId = noteIn(agent, "Paris");
        valueOf(
          agent.cell.library.landApart(
            { answer: z.literal(true), opId: undefined },
            (scope: LandingScope) => {
              runPlan(scope.storage, writeMeta("library_rules", "File travel under Trips."));
              return true as const;
            },
          ),
        );
        const sent = valueOf(
          await sendToAgent(agent.cell, {
            text: "Tidy this.",
            viewContext: { itemId, surface: "item" },
          }),
        );
        await agent.settled();
        const [session] = agent.api.sessions.values();
        // a system message is no initial event, so the first message rode a send beside it
        expect(session?.systemMessages).toEqual(["File travel under Trips."]);
        const create = agent.api.calls.find(
          (call) => call.method === "POST" && call.path === "/v1/sessions",
        );
        expect(create?.body).not.toContain("initial_events");
        const [message] = storedOf(state, sent.threadId, "user.message");
        expect(message).toMatchObject({
          content: [
            { text: `\`\`\`view-context\n${JSON.stringify({ itemId, surface: "item" })}\n\`\`\`` },
            { text: "Tidy this." },
          ],
        });
        const second = valueOf(
          await sendToAgent(agent.cell, { text: "And again.", threadId: sent.threadId }),
        );
        await agent.settled();
        expect(second.status).toBe("running");
        // a later turn of the same session says the rules no more
        expect(session?.systemMessages).toHaveLength(1);
      });
    },
  );

  it(
    "queues a second send behind the account's turn, and runs it once that one seals",
    { timeout: 30_000 },
    async () => {
      await inCell(cellOf(), async (state) => {
        const agent = await agentOn(state, {
          allowance: { dayCents: 100, dayTurns: 5, turnCents: 50 },
        });
        const itemId = noteIn(agent, "Old");
        const first = valueOf(
          await sendToAgent(agent.cell, {
            text: `call delete_items ${JSON.stringify({ ids: [itemId] })}`,
          }),
        );
        await agent.settled();
        expect(threadStatus(state, first.threadId)).toBe("awaiting_approval");
        const second = valueOf(await sendToAgent(agent.cell, { text: "Then this." }));
        expect(second.status).toBe("queued");
        const [asked] = pendingOf(agent);
        valueOf(
          await respondToAgent(agent.cell, {
            eventId: asked ?? "",
            result: "allow",
            threadId: first.threadId,
          }),
        );
        await agent.settled();
        expect(isDeleted(state, itemId)).toBe(true);
        expect(threadStatus(state, first.threadId)).toBe("idle");
        expect(threadStatus(state, second.threadId)).toBe("idle");
        expect(storedTypes(state, second.threadId)).toContain("agent.message");
        // two turns, two sets: the delete in the first, nothing written by the second
        expect(agentSets(state)).toHaveLength(1);
        expect(usageToday(state).turns).toBe(2);
      });
    },
  );

  it(
    "denies a paused call when the person cancels, and then interrupts the session",
    { timeout: 30_000 },
    async () => {
      await inCell(cellOf(), async (state) => {
        const agent = await agentOn(state);
        const itemId = noteIn(agent, "Keep");
        const sent = valueOf(
          await sendToAgent(agent.cell, {
            text: `call delete_items ${JSON.stringify({ ids: [itemId] })}`,
          }),
        );
        await agent.settled();
        const since = agent.api.calls.length;
        valueOf(await cancelTurn(agent.cell, { threadId: sent.threadId }));
        await agent.settled();
        const sends = agent.api.calls
          .slice(since)
          .filter((call) => call.method === "POST" && call.path.endsWith("/events"))
          .map((call) =>
            z
              .object({ events: z.array(z.looseObject({ type: z.string() })) })
              .parse(JSON.parse(call.body)),
          );
        expect(sends.map((body) => body.events.map((event) => event.type))).toEqual([
          ["user.tool_confirmation"],
          ["user.interrupt"],
        ]);
        expect(sends[0]?.events[0]).toMatchObject({
          deny_message: "The person stopped this before it ran.",
          result: "deny",
        });
        expect(isDeleted(state, itemId)).toBe(false);
        expect(turnOpen(state)).toBe(false);
        expect(threadStatus(state, sent.threadId)).toBe("idle");
        expect(storedOf(state, sent.threadId, "user.tool_confirmation")).toEqual([
          expect.objectContaining({ result: "deny" }),
        ]);
      });
    },
  );

  it(
    "denies an approval nobody answered once ten minutes pass, by the cell's own alarm",
    { timeout: 30_000 },
    async () => {
      const api = fakeManagedAgentsApi();
      const stopServing = serveInProcess(api);
      try {
        const stub = cellOf();
        const asked = await inCell(stub, async (state) => {
          const agent = await agentOn(state, { agents: servedAgents(), api });
          const itemId = noteIn(agent, "Keep");
          const sent = valueOf(
            await sendToAgent(agent.cell, {
              text: `call delete_items ${JSON.stringify({ ids: [itemId] })}`,
            }),
          );
          await agent.settled();
          expect(threadStatus(state, sent.threadId)).toBe("awaiting_approval");
          // ten minutes on, as the alarm meets it
          state.storage.sql.exec("UPDATE agent_turn SET asked_at = asked_at - 600000");
          state.storage.sql.exec("UPDATE jobs SET next_at = 0 WHERE id = 'agent-approval'");
          return { itemId, threadId: sent.threadId };
        });
        // the alarm set to the job now due runs, if the runtime has not run it already
        await inCell(stub, async (state) => {
          await state.storage.setAlarm(Date.now());
        });
        await runDurableObjectAlarm(stub);
        await vi.waitFor(
          async () => {
            await api.settled();
            expect(await inCell(stub, (state) => threadStatus(state, asked.threadId))).toBe("idle");
          },
          { interval: 50, timeout: 20_000 },
        );
        await inCell(stub, (state) => {
          expect(storedOf(state, asked.threadId, "user.tool_confirmation")).toEqual([
            expect.objectContaining({
              deny_message: "Nobody answered in time, so this was not done.",
              result: "deny",
            }),
          ]);
          expect(isDeleted(state, asked.itemId)).toBe(false);
        });
      } finally {
        stopServing();
      }
    },
  );

  it(
    "stops a thread whose turn reached its cap, and starts its next send in a fresh session seeded with what was said",
    { timeout: 30_000 },
    async () => {
      await inCell(cellOf(), async (state) => {
        const agent = await agentOn(state, {
          allowance: { dayCents: 100, dayTurns: 5, turnCents: 3 },
        });
        const sent = valueOf(await sendToAgent(agent.cell, { text: "spend 2\nspend 2\nspend 2" }));
        await agent.settled();
        expect(threadStatus(state, sent.threadId)).toBe("stopped");
        const [stopped] = agent.api.sessions.values();
        expect(stopped?.events.at(-1)).toMatchObject({ stop_reason: { type: "budget_reached" } });
        // the session the cap stopped is deleted at Anthropic by the alarm's job
        const { runTurnJobs } = await import("./agent-turns");
        await runTurnJobs(agent.cell);
        expect(agent.api.sessions.has(stopped?.id ?? "")).toBe(false);
        const again = valueOf(
          await sendToAgent(agent.cell, { text: "Go on.", threadId: sent.threadId }),
        );
        expect(again.status).toBe("running");
        await agent.settled();
        const [fresh] = agent.api.sessions.values();
        expect(fresh?.id).not.toBe(stopped?.id);
        const [first] = fresh?.events ?? [];
        expect(first).toMatchObject({
          content: [
            {
              text: `\`\`\`earlier-conversation\n${JSON.stringify({ role: "person", text: "spend 2\nspend 2\nspend 2" })}\n\`\`\``,
            },
            { text: "Go on." },
          ],
          type: "user.message",
        });
        expect(threadStatus(state, sent.threadId)).toBe("idle");
        // the ledger booked what each session spent, once
        expect(usageToday(state)).toEqual({ cost_cents: 5, turns: 2 });
      });
    },
  );

  it(
    "refuses a send once the day's allowance is spent, saying when it fills again",
    { timeout: 30_000 },
    async () => {
      await inCell(cellOf(), async (state) => {
        const agent = await agentOn(state, {
          allowance: { dayCents: 100, dayTurns: 1, turnCents: 50 },
        });
        const library = appClient(agent);
        expect(await library.agent.status()).toMatchObject({ enabled: true, turnsLeft: 1 });
        await library.agent.send({ text: "Once." });
        await agent.settled();
        expect(await library.agent.status()).toMatchObject({ turnsLeft: 0 });
        expect(await refusalOf(library.agent.send({ text: "Twice." }))).toMatchObject({
          code: "AGENT_BUDGET",
          data: { resetsAt: nextDayAt(Date.now()) },
          defined: true,
        });
      });
    },
  );

  it(
    "fails a send fast when Anthropic does not answer, and charges and keeps nothing",
    { timeout: 30_000 },
    async () => {
      await inCell(cellOf(), async (state) => {
        const agent = await agentOn(state);
        const library = appClient(agent);
        agent.api.failNext("POST", /^\/v1\/sessions$/u);
        const opId = crypto.randomUUID();
        expect(await refusalOf(library.agent.send({ opId, text: "Hello." }))).toMatchObject({
          code: "SERVICE_UNAVAILABLE",
          defined: true,
        });
        expect(usageToday(state).turns).toBe(0);
        expect(turnOpen(state)).toBe(false);
        const listed = await library.agent.list({});
        expect(listed.threads).toEqual([]);
        // the same send again, once Anthropic answers, is a send of its own
        const sent = await library.agent.send({ opId, text: "Hello." });
        expect(sent.status).toBe("running");
        await agent.settled();
        expect(usageToday(state).turns).toBe(1);
      });
    },
  );

  it(
    "interrupts and deletes a thread's session when the thread is deleted",
    { timeout: 30_000 },
    async () => {
      await inCell(cellOf(), async (state) => {
        const agent = await agentOn(state);
        const sent = valueOf(await sendToAgent(agent.cell, { text: "stall" }));
        await vi.waitFor(() => {
          expect([...agent.api.sessions.values()][0]?.status).toBe("running");
        });
        const [session] = agent.api.sessions.values();
        valueOf(await deleteAgentThread(agent.cell, { threadId: sent.threadId }));
        await agent.settled();
        expect(agent.api.sessions.has(session?.id ?? "")).toBe(false);
        expect(threadStatus(state, sent.threadId)).toBeNull();
        expect(turnOpen(state)).toBe(false);
        expect(state.storage.sql.exec("SELECT 1 FROM agent_sessions").toArray()).toEqual([]);
        const paths = agent.api.calls.map((call) => `${call.method} ${call.path}`);
        expect(paths.indexOf(`POST /v1/sessions/${session?.id ?? ""}/events`)).toBeLessThan(
          paths.indexOf(`DELETE /v1/sessions/${session?.id ?? ""}`),
        );
      });
    },
  );
});
