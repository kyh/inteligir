// A conversation's object over the scripted Messages API (apps/web/messages-service.ts), driven by
// its account's real cell: a turn's model calls and tool calls replayed as Claude returned them,
// its recovery when its instance dies mid-call or mid-tool, its approvals, its cancel, two
// conversations at once, and Claude refusing or failing. Every case ends with the fake having
// dropped no replayed thinking block, the proof that what the thread replays is what Claude sent.
// The loop's retries, which a deployed thread waits seconds for, are stepped by hand
// (`../test-support/thread-host`).

import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  agentAccount,
  asLaptop,
  cellRows,
  fakeStats,
  heldMidReply,
  heldSoFar,
  script,
  settled,
  storedTypes,
  threadOf,
  threadRows,
  threadStatus,
} from "../test-support/agent-turns";
import type { AgentAccount } from "../test-support/agent-turns";
import { inSteppedThread } from "../test-support/thread-host";
import type { AgentThreadDO } from "./agent-thread";
import { agentRequest, storedDefinition, transcriptMessage } from "./thread-request";

// a turn's end can take a few model calls, each a round trip through the fake
const TURN_MS = 30_000;

const callSchema = z.object({
  call_id: z.string(),
  max_tokens: z.number(),
  request_sha: z.string(),
  status: z.string(),
  step: z.number(),
  turn: z.number(),
});

const callsOf = async (account: AgentAccount, threadId: string) => {
  const rows = await threadRows(
    account.accountId,
    threadId,
    "SELECT call_id, turn, step, status, request_sha, max_tokens FROM model_calls ORDER BY turn, step, attempt",
  );
  return rows.map((row) => callSchema.parse(row));
};

const eventSchema = z.object({ event_id: z.string(), json: z.string(), type: z.string() });

const eventsOf = async (account: AgentAccount, threadId: string, type: string) => {
  const rows = await cellRows(
    account,
    "SELECT event_id, type, json FROM thread_events WHERE thread_id = ? AND type = ? ORDER BY idx",
    threadId,
    type,
  );
  return rows.map((row) => {
    const parsed = eventSchema.parse(row);
    return { event: z.json().parse(JSON.parse(parsed.json)), eventId: parsed.event_id };
  });
};

const endedSchema = z.object({ detail: z.string().optional(), reason: z.string() });

// how each of the thread's turns ended, in order
const endingsOf = async (account: AgentAccount, threadId: string) => {
  const ended = await eventsOf(account, threadId, "turn.ended");
  return ended.map(({ event }) => endedSchema.parse(event));
};

// where a stepped loop came to rest
const restsAt = async (run: () => Promise<readonly string[]>): Promise<string | undefined> => {
  const results = await run();
  return results.at(-1);
};

const send = async (account: AgentAccount, text: string, threadId?: string) =>
  await asLaptop(account, async (client) => await client.agent.send({ text, threadId }));

const noteIn = async (account: AgentAccount, markdown: string): Promise<string> => {
  const { item } = await asLaptop(
    account,
    async (client) => await client.items.createNote({ markdown }),
  );
  return item.id;
};

const isDeleted = async (account: AgentAccount, itemId: string): Promise<boolean> => {
  const read = await asLaptop(account, async (client) => await client.items.read({ id: itemId }));
  return read.fields.deletedAt !== null;
};

// the object's instance gone, as a deploy or an eviction takes it; the next one starts afresh
const abortThread = async (accountId: string, threadId: string): Promise<void> => {
  await expect(
    runInDurableObject(threadOf(accountId, threadId), (_thread: AgentThreadDO, state) => {
      state.abort("the object was reset");
    }),
  ).rejects.toThrow();
};

const hex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const sha256 = async (text: string): Promise<string> =>
  hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

afterEach(async () => {
  const stats = await fakeStats();
  expect(stats.drops).toBe(0);
});

describe("a conversation's object", () => {
  it(
    "runs a two-step turn, replaying the first step's reply as it came, its events stored once",
    { timeout: TURN_MS },
    async () => {
      const account = agentAccount();
      const sent = await send(account, script('call create_note {"markdown":"Paris."}'));
      expect(sent.status).toBe("running");
      await settled(account, sent.threadId);
      expect(await storedTypes(account, sent.threadId)).toEqual([
        "user.message",
        "agent.tool_use",
        "agent.tool_result",
        "agent.message",
        "turn.ended",
      ]);
      const listed = await asLaptop(account, async (client) => await client.items.list({}));
      expect(listed.items).toHaveLength(1);
      // each call's body is the definition and the transcript as stored, byte for byte
      const [definitionRow] = await threadRows(
        account.accountId,
        sent.threadId,
        "SELECT system, tools FROM definition",
      );
      const definition = storedDefinition(
        z.object({ system: z.string(), tools: z.string() }).parse(definitionRow),
      );
      const rows = await threadRows(
        account.accountId,
        sent.threadId,
        "SELECT role, content FROM transcript ORDER BY seq",
      );
      const transcript = rows.map((row) => {
        const parsed = z.object({ content: z.string(), role: z.string() }).parse(row);
        return transcriptMessage(parsed.role, parsed.content);
      });
      expect(transcript.map((message) => message.role)).toEqual([
        "user",
        "assistant",
        "user",
        "assistant",
      ]);
      const calls = await callsOf(account, sent.threadId);
      expect(calls.map((call) => [call.step, call.status])).toEqual([
        [0, "done"],
        [1, "done"],
      ]);
      for (const [index, call] of calls.entries()) {
        const sentBefore = transcript.slice(0, index * 2 + 1);
        const body = agentRequest(definition, sentBefore, call.max_tokens);
        expect(await sha256(JSON.stringify(body)), `step ${String(index)}`).toBe(call.request_sha);
      }
    },
  );

  for (const [where, lines] of [
    ["thinking", ["stall thinking", 'call create_note {"markdown":"Cut in thought."}']],
    ["tool_use", ["stall", 'call create_note {"markdown":"Cut in a call."}']],
    ["text", ['call create_note {"markdown":"Cut in words."}', "stall"]],
  ] as const) {
    it(
      `sends a call cut mid-${where} again whole, the same bytes, and lands one reply`,
      { timeout: TURN_MS },
      async () => {
        const account = agentAccount();
        const before = await heldSoFar();
        const sent = await send(account, script(...lines));
        await heldMidReply(account, [sent.threadId], before);
        await abortThread(account.accountId, sent.threadId);
        // no event at all: the alarm the watchdog left wakes a fresh instance, which finds the cut
        expect(await runDurableObjectAlarm(threadOf(account.accountId, sent.threadId))).toBe(true);
        await settled(account, sent.threadId);
        const calls = await callsOf(account, sent.threadId);
        const cut = calls.filter((call) => call.status === "cut");
        expect(cut).toHaveLength(1);
        const [cutCall] = cut;
        const again = calls.filter((call) => call.step === cutCall?.step && call.status === "done");
        expect(again).toHaveLength(1);
        expect(again[0]?.request_sha).toBe(cutCall?.request_sha);
        expect(again[0]?.max_tokens).toBe(cutCall?.max_tokens);
        expect(await endingsOf(account, sent.threadId)).toEqual([{ reason: "done" }]);
        const replies = await threadRows(
          account.accountId,
          sent.threadId,
          "SELECT seq FROM transcript WHERE role = 'assistant'",
        );
        expect(replies).toHaveLength(calls.filter((call) => call.status === "done").length);
        // the cut call is booked at what it reserved, which bounds what it cost
        const [booked] = await cellRows(
          account,
          "SELECT reserved_ucents, cost_ucents FROM agent_calls WHERE call_id = ?",
          cutCall?.call_id ?? "",
        );
        expect(booked?.["cost_ucents"]).toBe(booked?.["reserved_ucents"]);
        const listed = await asLaptop(account, async (client) => await client.items.list({}));
        expect(listed.items).toHaveLength(1);
      },
    );
  }

  it(
    "keeps an approval through a reset, and runs the delete once when the person allows it",
    { timeout: TURN_MS },
    async () => {
      const account = agentAccount();
      const itemId = await noteIn(account, "To go.");
      const sent = await send(account, script(`call delete_items {"ids":["${itemId}"]}`));
      await vi.waitFor(
        async () => {
          expect(await threadStatus(account, sent.threadId)).toBe("awaiting_approval");
        },
        { interval: 50, timeout: 10_000 },
      );
      await abortThread(account.accountId, sent.threadId);
      const [asked] = await eventsOf(account, sent.threadId, "approval.asked");
      await asLaptop(
        account,
        async (client) =>
          await client.agent.respond({
            eventId: asked?.eventId ?? "",
            result: "allow",
            threadId: sent.threadId,
          }),
      );
      await settled(account, sent.threadId);
      expect(await isDeleted(account, itemId)).toBe(true);
      const answered = await eventsOf(account, sent.threadId, "approval.answered");
      expect(answered.map(({ event }) => event)).toEqual([
        expect.objectContaining({ by: "person", result: "allow" }),
      ]);
      const [tool] = await threadRows(
        account.accountId,
        sent.threadId,
        "SELECT attempts, is_error FROM tool_calls",
      );
      expect(tool).toEqual({ attempts: 1, is_error: 0 });
      // a second answer decides nothing
      const decided = await threadOf(account.accountId, sent.threadId).respond({
        approved: false,
        reason: null,
        toolUseId: z.object({ toolUseId: z.string() }).parse(asked?.event).toolUseId,
      });
      expect(decided).toEqual({ decided: false });
    },
  );

  it("runs nothing the person denies, and says why", { timeout: TURN_MS }, async () => {
    const account = agentAccount();
    const itemId = await noteIn(account, "To keep.");
    const sent = await send(account, script(`call delete_items {"ids":["${itemId}"]}`));
    await vi.waitFor(
      async () => {
        expect(await eventsOf(account, sent.threadId, "approval.asked")).toHaveLength(1);
      },
      { interval: 50, timeout: 10_000 },
    );
    const [asked] = await eventsOf(account, sent.threadId, "approval.asked");
    await asLaptop(
      account,
      async (client) =>
        await client.agent.respond({
          denyMessage: "Keep it.",
          eventId: asked?.eventId ?? "",
          result: "deny",
          threadId: sent.threadId,
        }),
    );
    await settled(account, sent.threadId);
    expect(await isDeleted(account, itemId)).toBe(false);
    const [result] = await eventsOf(account, sent.threadId, "agent.tool_result");
    expect(result?.event).toMatchObject({
      isError: true,
      summary: "The person declined this, so it did not run. Keep it.",
    });
  });

  it(
    "denies an approval nobody answers once its ten minutes are up",
    { timeout: TURN_MS },
    async () => {
      const account = agentAccount();
      const itemId = await noteIn(account, "Left alone.");
      const sent = await send(account, script(`call delete_items {"ids":["${itemId}"]}`));
      await vi.waitFor(
        async () => {
          expect(await eventsOf(account, sent.threadId, "approval.asked")).toHaveLength(1);
        },
        { interval: 50, timeout: 10_000 },
      );
      const [asked] = await eventsOf(account, sent.threadId, "approval.asked");
      const { toolUseId } = z.object({ toolUseId: z.string() }).parse(asked?.event);
      const thread = threadOf(account.accountId, sent.threadId);
      // the ten minutes, passed: the job due now, and the alarm run
      await runInDurableObject(thread, async (object: AgentThreadDO) => {
        expect(await object.lifecycle.jobs.reschedule(`approval:${toolUseId}`, Date.now())).toBe(
          true,
        );
      });
      await runDurableObjectAlarm(thread);
      await settled(account, sent.threadId);
      expect(await isDeleted(account, itemId)).toBe(false);
      const answered = await eventsOf(account, sent.threadId, "approval.answered");
      expect(answered.map(({ event }) => event)).toEqual([
        expect.objectContaining({ by: "timeout", result: "deny" }),
      ]);
    },
  );

  it(
    "stops a turn mid-reply, and the next turn goes on in the same conversation",
    { timeout: TURN_MS },
    async () => {
      const account = agentAccount();
      const before = await heldSoFar();
      const sent = await send(account, script("stall"));
      await heldMidReply(account, [sent.threadId], before);
      await asLaptop(
        account,
        async (client) => await client.agent.cancel({ threadId: sent.threadId }),
      );
      await settled(account, sent.threadId);
      const next = await send(account, script("And now?"), sent.threadId);
      expect(next).toEqual({ status: "running", threadId: sent.threadId });
      await settled(account, sent.threadId);
      expect(await endingsOf(account, sent.threadId)).toEqual([
        { reason: "cancelled" },
        { reason: "done" },
      ]);
    },
  );

  it(
    "stops a turn waiting on the person, denying the call, and the next turn is accepted",
    { timeout: TURN_MS },
    async () => {
      const account = agentAccount();
      const itemId = await noteIn(account, "Not this one.");
      const sent = await send(account, script(`call delete_items {"ids":["${itemId}"]}`));
      await vi.waitFor(
        async () => {
          expect(await threadStatus(account, sent.threadId)).toBe("awaiting_approval");
        },
        { interval: 50, timeout: 10_000 },
      );
      await asLaptop(
        account,
        async (client) => await client.agent.cancel({ threadId: sent.threadId }),
      );
      await settled(account, sent.threadId);
      const answered = await eventsOf(account, sent.threadId, "approval.answered");
      expect(answered.map(({ event }) => event)).toEqual([
        expect.objectContaining({ by: "cancel", result: "deny" }),
      ]);
      await send(account, script("Never mind."), sent.threadId);
      await settled(account, sent.threadId);
      expect(await endingsOf(account, sent.threadId)).toEqual([
        { reason: "cancelled" },
        { reason: "done" },
      ]);
      expect(await isDeleted(account, itemId)).toBe(false);
    },
  );

  it(
    "streams two conversations at once, and a second send to one waits its turn",
    { timeout: TURN_MS },
    async () => {
      const account = agentAccount();
      // a day of more turns than the deployed two, so the queue is what holds them
      const roomy: Env = {
        ...env,
        AGENT_ALLOWANCE: { concurrentTurns: 2, dayCents: 100, dayTurns: 10, turnCents: 50 },
      };
      const sendAs = async (text: string, threadId?: string) =>
        await asLaptop(account, async (client) => await client.agent.send({ text, threadId }), {
          env: roomy,
        });
      const before = await heldSoFar();
      const first = await sendAs(script("stall"));
      const second = await sendAs(script("stall"));
      await heldMidReply(account, [first.threadId, second.threadId], before);
      // both held open at once, each in its own object
      for (const threadId of [first.threadId, second.threadId]) {
        const inspection = await threadOf(account.accountId, threadId).inspect();
        expect(inspection).toMatchObject({ driving: true, status: "running", turn: 1 });
      }
      expect(await sendAs(script("Wait for me."), first.threadId)).toEqual({
        status: "queued",
        threadId: first.threadId,
      });
      // the account runs two at once: a third conversation waits for either
      const third = await sendAs(script("And me."));
      expect(third.status).toBe("queued");
      expect(await threadStatus(account, third.threadId)).toBe("queued");
      await asLaptop(account, async (client) => {
        await client.agent.cancel({ threadId: first.threadId });
        await client.agent.cancel({ threadId: second.threadId });
      });
      for (const threadId of [first.threadId, second.threadId, third.threadId]) {
        await settled(account, threadId);
      }
      // the stopped thread's waiting send went with its turn; the third opened once a turn sealed,
      // and found the day's cost held by the two stopped calls, each booked at what it reserved
      expect(await endingsOf(account, first.threadId)).toEqual([{ reason: "cancelled" }]);
      expect(await endingsOf(account, third.threadId)).toEqual([{ reason: "budget" }]);
      const [stopped] = await cellRows(
        account,
        "SELECT sum(reserved_ucents) AS reserved, sum(cost_ucents) AS cost FROM agent_calls WHERE cut = 1",
      );
      expect(stopped?.["cost"]).toBe(stopped?.["reserved"]);
      // the third turn cost nothing, so it was given back
      const [usage] = await cellRows(account, "SELECT turns FROM agent_usage");
      expect(usage).toEqual({ turns: 2 });
    },
  );

  it("ends a turn Claude refuses with the refusal's category", { timeout: TURN_MS }, async () => {
    const account = agentAccount();
    const sent = await send(account, script("refuse cyber"));
    await settled(account, sent.threadId);
    expect(await endingsOf(account, sent.threadId)).toEqual([
      { detail: "cyber", reason: "refusal" },
    ]);
    // nothing of the declined reply is kept, and the conversation goes on
    const replies = await threadRows(
      account.accountId,
      sent.threadId,
      "SELECT seq FROM transcript WHERE role = 'assistant'",
    );
    expect(replies).toEqual([]);
    await send(account, script("Something else."), sent.threadId);
    await settled(account, sent.threadId);
    expect(await endingsOf(account, sent.threadId)).toEqual([
      { detail: "cyber", reason: "refusal" },
      { reason: "done" },
    ]);
  });

  it(
    "goes on with the fallback model's answer, each model's part booked at its own prices",
    { timeout: TURN_MS },
    async () => {
      const account = agentAccount();
      const sent = await send(account, script("fallback"));
      await settled(account, sent.threadId);
      expect(await endingsOf(account, sent.threadId)).toEqual([{ reason: "done" }]);
      const messages = await eventsOf(account, sent.threadId, "agent.message");
      expect(messages.map(({ event }) => event)).toEqual([
        { text: "Answered by the fallback model.", type: "agent.message" },
      ]);
      const [usage] = await cellRows(account, "SELECT output_tokens, cost_ucents FROM agent_usage");
      expect(usage?.["cost_ucents"]).toBeGreaterThan(0);
      await send(account, script("Thanks."), sent.threadId);
      await settled(account, sent.threadId);
      expect(await endingsOf(account, sent.threadId)).toEqual([
        { reason: "done" },
        { reason: "done" },
      ]);
    },
  );
});

describe("a conversation's loop, stepped", () => {
  it(
    "sends a call Claude could not take again, the same bytes, until it lands",
    { timeout: TURN_MS },
    async () => {
      const account = agentAccount();
      const threadId = crypto.randomUUID();
      await inSteppedThread(account, threadId, script("fail 529 2"), async ({ asked, run }) => {
        expect(await run()).toEqual(["continue", "later"]);
        expect(await run()).toEqual(["later"]);
        // after 2 s, then 10 s, each a retry the drive job was timed for
        const [first = 0, second = 0] = asked.drives;
        expect(second - first).toBeGreaterThanOrEqual(8000);
        expect(await restsAt(run)).toBe("idle");
      });
      const calls = await callsOf(account, threadId);
      expect(calls.map((call) => call.status)).toEqual(["failed", "failed", "done"]);
      expect(new Set(calls.map((call) => call.request_sha)).size).toBe(1);
      expect(await endingsOf(account, threadId)).toEqual([{ reason: "done" }]);
    },
  );

  it(
    "ends a turn Claude stays unreachable for, and gives the turn back",
    { timeout: TURN_MS },
    async () => {
      const account = agentAccount();
      const threadId = crypto.randomUUID();
      await inSteppedThread(account, threadId, script("fail 529 9"), async ({ asked, run }) => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          expect(await restsAt(run)).toBe("later");
        }
        expect(await restsAt(run)).toBe("idle");
        expect(asked.drives).toHaveLength(3);
      });
      expect(await endingsOf(account, threadId)).toEqual([
        { detail: "status 529", reason: "unavailable" },
      ]);
      const [usage] = await cellRows(account, "SELECT turns, cost_ucents FROM agent_usage");
      expect(usage).toEqual({ cost_ucents: 0, turns: 0 });
    },
  );

  it("runs a tool cut mid-run again, under the op id it first ran by, landing once", async () => {
    const account = agentAccount();
    const threadId = crypto.randomUUID();
    let cut = false;
    await inSteppedThread(
      account,
      threadId,
      script('call create_note {"markdown":"Landed once."}'),
      async ({ run }) => {
        // the tool ran in the cell, then the instance died before it heard the answer
        expect(await restsAt(run)).toBe("later");
        expect(await restsAt(run)).toBe("idle");
      },
      {
        cell: (real) => ({
          ...real,
          agentPreview: real.agentPreview,
          agentPush: real.agentPush,
          agentReserve: real.agentReserve,
          agentTool: async (request) => {
            const answer = await real.agentTool(request);
            if (!cut) {
              cut = true;
              throw new Error("the instance died before it heard the answer");
            }
            return answer;
          },
        }),
      },
    );
    const [tool] = await threadRows(
      account.accountId,
      threadId,
      "SELECT attempts, status, is_error FROM tool_calls",
    );
    expect(tool).toEqual({ attempts: 2, is_error: 0, status: "done" });
    const listed = await asLaptop(account, async (client) => await client.items.list({}));
    expect(listed.items).toHaveLength(1);
    expect(await endingsOf(account, threadId)).toEqual([{ reason: "done" }]);
  });
});
