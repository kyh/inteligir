// A conversation's object over the scripted Messages API (packages/service/messages-service.ts),
// driven by its account's real cell: a turn's model calls and tool calls replayed as Claude
// returned them, its progress notes, its transcript kept across a second wake, its recovery when
// its instance dies mid-call or mid-tool, its approvals, its cancel, two conversations at once,
// Claude refusing or failing, a turn ended at its last step, a compaction on the server, a delete
// mid-reply, and a deploy's definition taken up between turns. Every case ends with the fake having
// dropped no replayed thinking block, the proof that what the thread replays is what Claude sent.
// The loop's retries, which a deployed thread waits seconds for, and a deploy's new definition are
// stepped by hand (`../test-support/thread-host`).

import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
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
  threadHolds,
  threadOf,
  threadRows,
  threadStatus,
} from "../test-support/agent-turns";
import type { AgentAccount } from "../test-support/agent-turns";
import { blockTypesOf, expectSharedPrefixes, unmarkedOf } from "../test-support/request-bodies";
import { cellOf } from "../test-support/library-cell";
import { inSteppedThread } from "../test-support/thread-host";
import { pricesOf, priceUsage, usageReportSchema } from "./agent-allowance";
import type { AgentThreadDO } from "./agent-thread";
import { AGENT_MAX_STEPS, AGENT_MODEL } from "./library-agent";
import { cutSilentCalls, requestCancel } from "./thread-loop";
import type { ThreadHost } from "./thread-loop";
import {
  agentRequest,
  deployedDefinition,
  requestMessages,
  storedDefinition,
  transcriptMessage,
} from "./thread-request";
import type { ThreadDefinition } from "./thread-request";
import { RULES_CLEARED } from "./turn-message";

// a turn's end can take a few model calls, each a round trip through the fake
const TURN_MS = 30_000;

const callSchema = z.object({
  call_id: z.string(),
  request_sha: z.string().nullable(),
  status: z.string(),
  step: z.number(),
  turn: z.number(),
});

const callsOf = async (account: AgentAccount, threadId: string) => {
  const rows = await threadRows(
    account.accountId,
    threadId,
    "SELECT call_id, turn, step, status, request_sha FROM model_calls ORDER BY turn, step, attempt",
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

const MINUTE_MS = 60_000;

// where a stepped loop came to rest
const restsAt = async (run: () => Promise<readonly string[]>): Promise<string | undefined> => {
  const results = await run();
  return results.at(-1);
};

// a day of more turns than the deployed two, for a case that runs more
const ROOMY: Env = {
  ...env,
  AGENT_ALLOWANCE: { concurrentTurns: 2, dayCents: 100, dayTurns: 10 },
};

const send = async (account: AgentAccount, text: string, threadId?: string, sendEnv = env) =>
  await asLaptop(account, async (client) => await client.agent.send({ text, threadId }), {
    env: sendEnv,
  });

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
  ).rejects.toThrow("the object was reset");
};

const hex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const sha256 = async (text: string): Promise<string> =>
  hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

const transcriptRowSchema = z.object({
  content: z.string(),
  role: z.string(),
  seq: z.number(),
  turn: z.number(),
});

const transcriptOf = async (account: AgentAccount, threadId: string) => {
  const rows = await threadRows(
    account.accountId,
    threadId,
    "SELECT seq, turn, role, content FROM transcript ORDER BY seq",
  );
  return rows.map((row) => transcriptRowSchema.parse(row));
};

const definitionRowSchema = z.object({
  effort: z.string(),
  model: z.string(),
  since_seq: z.number(),
  system: z.string(),
  tools: z.string(),
});

const definitionsOf = async (account: AgentAccount, threadId: string) => {
  const rows = await threadRows(
    account.accountId,
    threadId,
    "SELECT model, effort, system, tools, since_seq FROM definition ORDER BY id",
  );
  return rows.map((row) => definitionRowSchema.parse(row));
};

// every reply's call was asked under the definition in force at its turn with what a request
// carries of every message kept before the reply, byte for byte as the thread keeps them
const expectRepliesAskedAsKept = async (account: AgentAccount, threadId: string) => {
  const definitions = await definitionsOf(account, threadId);
  const rows = await transcriptOf(account, threadId);
  const messages = rows.map((row) => ({
    ...transcriptMessage(row.role, row.content),
    seq: row.seq,
  }));
  const replies = rows.flatMap((row, index) => (row.role === "assistant" ? [index] : []));
  const calls = await callsOf(account, threadId);
  const landed = calls.filter((call) => call.status === "done");
  expect(landed).toHaveLength(replies.length);
  for (const [index, call] of landed.entries()) {
    const at = replies[index] ?? 0;
    const seq = rows[at]?.seq ?? 0;
    const inForce = definitions.findLast((definition) => definition.since_seq < seq);
    if (inForce === undefined) {
      throw new Error(`reply ${String(index)} came before any definition`);
    }
    const body = agentRequest(
      storedDefinition(inForce),
      requestMessages(messages.slice(0, at), inForce.since_seq),
    );
    await expect(sha256(JSON.stringify(body)), `reply ${String(index)}`).resolves.toBe(
      call.request_sha,
    );
  }
};

// the system and the tools a body sent, as the JSON it sent them as
const definitionSent = (body: string) => {
  const unmarked = unmarkedOf(body);
  return { system: JSON.stringify(unmarked.system), tools: JSON.stringify(unmarked.tools) };
};

// the system and the tools a definition sends
const sentAs = (definition: ThreadDefinition) => ({
  system: JSON.stringify(definition.system),
  tools: JSON.stringify(definition.tools),
});

// the filing rules as a system message holds them
const rulesMessage = (text: string) => z.json().parse([{ text, type: "text" }]);

// the library's filing rules as the person left them
const rulesIn = async (account: AgentAccount, rules: string): Promise<void> => {
  await cellRows(
    account,
    "INSERT INTO meta (k, v) VALUES ('library_rules', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v",
    rules,
  );
};

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
      await expect(storedTypes(account, sent.threadId)).resolves.toStrictEqual([
        "user.message",
        "agent.progress",
        "agent.tool_use",
        "agent.tool_result",
        "agent.message",
        "turn.ended",
      ]);
      const listed = await asLaptop(account, async (client) => await client.items.list({}));
      expect(listed.items).toHaveLength(1);
      const transcript = await transcriptOf(account, sent.threadId);
      expect(transcript.map((message) => message.role)).toStrictEqual([
        "user",
        "assistant",
        "user",
        "assistant",
      ]);
      const calls = await callsOf(account, sent.threadId);
      expect(calls.map((call) => [call.step, call.status])).toStrictEqual([
        [0, "done"],
        [1, "done"],
      ]);
      await expectRepliesAskedAsKept(account, sent.threadId);
    },
  );

  it(
    "tells each progress note once, ahead of the tool call it introduces, and replays its block unchanged",
    { timeout: TURN_MS },
    async () => {
      const account = agentAccount();
      const sent = await send(
        account,
        script('call create_note {"markdown":"Noted."}', 'call search_library {"query":"Noted"}'),
      );
      await settled(account, sent.threadId);
      await expect(storedTypes(account, sent.threadId)).resolves.toStrictEqual([
        "user.message",
        "agent.progress",
        "agent.tool_use",
        "agent.tool_result",
        "agent.progress",
        "agent.tool_use",
        "agent.tool_result",
        "agent.message",
        "turn.ended",
      ]);
      const notes = await eventsOf(account, sent.threadId, "agent.progress");
      expect(notes.map(({ event }) => event)).toStrictEqual([
        { text: "Calling create_note now.", type: "agent.progress" },
        { text: "Calling search_library now.", type: "agent.progress" },
      ]);
      // a reasoning block shows nothing under `updates`, so it tells nothing
      const replies = await transcriptOf(account, sent.threadId);
      const thoughts = replies.flatMap((row) =>
        row.role === "assistant"
          ? z
              .array(z.looseObject({ thinking: z.string().optional(), type: z.string() }))
              .parse(JSON.parse(row.content))
              .flatMap((block) => (block.type === "thinking" ? [block.thinking ?? ""] : []))
          : [],
      );
      expect(thoughts.filter((thought) => thought !== "")).toHaveLength(notes.length);
      await expectRepliesAskedAsKept(account, sent.threadId);
    },
  );

  it(
    "keeps its transcript across a second wake, its tables migrated once",
    { timeout: TURN_MS },
    async () => {
      const account = agentAccount();
      const sent = await send(account, script("Remember Paris."));
      await settled(account, sent.threadId);
      const warned = vi.spyOn(console, "warn");
      // the instance gone, as an eviction takes it: the next wake runs its constructor again
      await evictDurableObject(threadOf(account.accountId, sent.threadId));
      await send(account, script("And Rome."), sent.threadId);
      await settled(account, sent.threadId);
      expect(warned).not.toHaveBeenCalledWith(
        expect.objectContaining({ event: "thread-schema-reset" }),
      );
      warned.mockRestore();
      const transcript = await transcriptOf(account, sent.threadId);
      expect(transcript.map((row) => [row.turn, row.role])).toStrictEqual([
        [1, "user"],
        [1, "assistant"],
        [2, "user"],
        [2, "assistant"],
      ]);
      await expectRepliesAskedAsKept(account, sent.threadId);
    },
  );

  it(
    "goes on past a compaction on the server, replaying from it, its summarizing booked with the reply",
    // eight model calls in two turns, each a round trip through the fake
    { timeout: 2 * TURN_MS },
    async () => {
      const account = agentAccount();
      await rulesIn(account, "File trips under Travel.");
      const searches = Array.from(
        { length: 5 },
        (_, index) => `call search_library {"query":"trip ${String(index)}"}`,
      );
      const threadId = crypto.randomUUID();
      // every reply's usage as the thread pushed it to the cell
      const usages: z.infer<typeof usageReportSchema>[] = [];
      await inSteppedThread(
        account,
        threadId,
        // the compaction opens the second step's reply; five steps follow it
        script('call create_note {"markdown":"Before."}', "compact", ...searches),
        async ({ deliver, run }) => {
          await expect(restsAt(run)).resolves.toBe("idle");
          // the next turn answers, sending the filing rules again: the compaction summarized them
          await deliver(script("And now?"));
          await expect(restsAt(run)).resolves.toBe("idle");
        },
        {
          cell: (real) => ({
            agentPreview: real.agentPreview,
            agentPush: async (request) => {
              for (const entry of request.entries) {
                if (entry.kind === "usage") {
                  usages.push(usageReportSchema.parse(entry.usage));
                }
              }
              return await real.agentPush(request);
            },
            agentTool: real.agentTool,
          }),
        },
      );
      await expect(endingsOf(account, threadId)).resolves.toStrictEqual([
        { reason: "done" },
        { reason: "done" },
      ]);
      const transcript = await transcriptOf(account, threadId);
      const blocksSchema = z.array(z.looseObject({ type: z.string() }));
      const opening = transcript.flatMap((row) =>
        row.role === "assistant" && row.turn === 1
          ? [blocksSchema.parse(JSON.parse(row.content)).map((block) => block.type)]
          : [],
      );
      expect(opening.map((types) => types[0])).toStrictEqual([
        "thinking",
        "compaction",
        "thinking",
        "thinking",
        "thinking",
        "thinking",
        "thinking",
      ]);
      expect(transcript.filter((row) => row.turn === 2).map((row) => row.role)).toStrictEqual([
        "user",
        "system",
        "assistant",
      ]);
      // every call after the compaction asked from it on, byte for byte as kept
      await expectRepliesAskedAsKept(account, threadId);
      // the compacting reply's summary pass priced beside its answer, and every reply booked
      expect(usages).toHaveLength(8);
      const [, compacting] = usages;
      expect(compacting?.iterations?.map((entry) => entry.type)).toStrictEqual([
        "compaction",
        "message",
      ]);
      const table = pricesOf(env);
      const priced = priceUsage(compacting ?? {}, AGENT_MODEL.id, table);
      const answering = priceUsage(
        {
          ...compacting,
          iterations: compacting?.iterations?.filter((entry) => entry.type !== "compaction"),
        },
        AGENT_MODEL.id,
        table,
      );
      expect(priced).toBeGreaterThan(answering);
      const [booked] = await cellRows(account, "SELECT cost_ucents FROM agent_usage");
      expect(booked?.cost_ucents).toBe(
        usages.reduce((sum, usage) => sum + priceUsage(usage, AGENT_MODEL.id, table), 0),
      );
    },
  );

  it(
    "sends the filing rules after the person's message while they are new, and keeps them with the reply",
    // five turns, one of them stopped mid-reply
    { timeout: 2 * TURN_MS },
    async () => {
      const account = agentAccount();
      await rulesIn(account, "File trips under Travel.");
      // a turn of two steps: the second replays the rules where the first left them
      const { threadId } = await send(
        account,
        script('call create_note {"markdown":"Trips go under Travel."}'),
        undefined,
        ROOMY,
      );
      await settled(account, threadId);
      // the same rules again: nothing new to send
      await send(account, script("And the next one?"), threadId, ROOMY);
      await settled(account, threadId);
      await rulesIn(account, "File trips under Journeys.");
      await send(account, script("Changed my mind."), threadId, ROOMY);
      await settled(account, threadId);
      // a turn stopped before its first reply lands keeps no rules, so the next turn sends them
      await rulesIn(account, "File trips by year.");
      const before = await heldSoFar();
      await send(account, script("stall"), threadId, ROOMY);
      await heldMidReply(account, [threadId], before);
      await asLaptop(account, async (client) => await client.agent.cancel({ threadId }));
      await settled(account, threadId);
      await send(account, script("Once more."), threadId, ROOMY);
      await settled(account, threadId);
      const transcript = await transcriptOf(account, threadId);
      expect(
        transcript.map((row) =>
          row.role === "system"
            ? [row.turn, row.role, z.json().parse(JSON.parse(row.content))]
            : [row.turn, row.role],
        ),
      ).toStrictEqual([
        [1, "user"],
        [1, "system", rulesMessage("File trips under Travel.")],
        [1, "assistant"],
        [1, "user"],
        [1, "assistant"],
        [2, "user"],
        [2, "assistant"],
        [3, "user"],
        [3, "system", rulesMessage("File trips under Journeys.")],
        [3, "assistant"],
        [4, "user"],
        [5, "user"],
        [5, "system", rulesMessage("File trips by year.")],
        [5, "assistant"],
      ]);
      await expect(endingsOf(account, threadId)).resolves.toStrictEqual([
        { reason: "done" },
        { reason: "done" },
        { reason: "done" },
        { reason: "cancelled" },
        { reason: "done" },
      ]);
      // each first reply was asked with its rules last, and every later call replays them in place
      await expectRepliesAskedAsKept(account, threadId);
    },
  );

  it(
    "tells a conversation that carried filing rules they are cleared, once, and sends them again when they return",
    // four turns, and two in a conversation that never carried any
    { timeout: 2 * TURN_MS },
    async () => {
      const account = agentAccount();
      const { threadId: plain } = await send(account, script("First."), undefined, ROOMY);
      await settled(account, plain);
      await rulesIn(account, "");
      await send(account, script("Second."), plain, ROOMY);
      await settled(account, plain);
      const none = await transcriptOf(account, plain);
      expect(none.map((row) => row.role)).toStrictEqual(["user", "assistant", "user", "assistant"]);

      await rulesIn(account, "File trips under Travel.");
      const { threadId } = await send(account, script("Noted."), undefined, ROOMY);
      await settled(account, threadId);
      await rulesIn(account, "  \n");
      await send(account, script("Cleared."), threadId, ROOMY);
      await settled(account, threadId);
      await send(account, script("Still cleared."), threadId, ROOMY);
      await settled(account, threadId);
      await rulesIn(account, "File trips under Travel.");
      await send(account, script("Back again."), threadId, ROOMY);
      await settled(account, threadId);
      const transcript = await transcriptOf(account, threadId);
      expect(
        transcript.map((row) =>
          row.role === "system"
            ? [row.turn, row.role, z.json().parse(JSON.parse(row.content))]
            : [row.turn, row.role],
        ),
      ).toStrictEqual([
        [1, "user"],
        [1, "system", rulesMessage("File trips under Travel.")],
        [1, "assistant"],
        [2, "user"],
        [2, "system", rulesMessage(RULES_CLEARED)],
        [2, "assistant"],
        [3, "user"],
        [3, "assistant"],
        [4, "user"],
        [4, "system", rulesMessage("File trips under Travel.")],
        [4, "assistant"],
      ]);
      await expectRepliesAskedAsKept(account, threadId);
    },
  );

  it(
    "tells a conversation past a compaction its filing rules are cleared, since the summary may hold them",
    // three model calls in two turns, each a round trip through the fake
    { timeout: 2 * TURN_MS },
    async () => {
      const account = agentAccount();
      await rulesIn(account, "File trips under Travel.");
      const { threadId } = await send(
        account,
        script('call create_note {"markdown":"Before."}', "compact", "Done."),
        undefined,
        ROOMY,
      );
      await settled(account, threadId);
      await rulesIn(account, "");
      await send(account, script("Cleared."), threadId, ROOMY);
      await settled(account, threadId);
      const transcript = await transcriptOf(account, threadId);
      expect(
        transcript.flatMap((row) =>
          row.role === "system" ? [[row.turn, z.json().parse(JSON.parse(row.content))]] : [],
        ),
      ).toStrictEqual([
        [1, rulesMessage("File trips under Travel.")],
        [2, rulesMessage(RULES_CLEARED)],
      ]);
      await expectRepliesAskedAsKept(account, threadId);
    },
  );

  it.for([
    {
      lines: ["stall thinking", 'call create_note {"markdown":"Cut in thought."}'],
      where: "thinking",
    },
    { lines: ["stall", 'call create_note {"markdown":"Cut in a call."}'], where: "tool_use" },
    { lines: ['call create_note {"markdown":"Cut in words."}', "stall"], where: "text" },
  ] as const)(
    "sends a call cut mid-$where again whole, the same bytes, and lands one reply",
    { timeout: TURN_MS },
    async ({ lines }) => {
      const account = agentAccount();
      const before = await heldSoFar();
      const sent = await send(account, script(...lines));
      await heldMidReply(account, [sent.threadId], before);
      await abortThread(account.accountId, sent.threadId);
      // no event at all: the alarm the watchdog left wakes a fresh instance, which finds the cut
      await expect(runDurableObjectAlarm(threadOf(account.accountId, sent.threadId))).resolves.toBe(
        true,
      );
      await settled(account, sent.threadId);
      const calls = await callsOf(account, sent.threadId);
      const cut = calls.filter((call) => call.status === "cut");
      expect(cut).toHaveLength(1);
      const [cutCall] = cut;
      const again = calls.filter((call) => call.step === cutCall?.step && call.status === "done");
      expect(again).toHaveLength(1);
      expect(again[0]?.request_sha).toBe(cutCall?.request_sha);
      await expect(endingsOf(account, sent.threadId)).resolves.toStrictEqual([{ reason: "done" }]);
      const replies = await threadRows(
        account.accountId,
        sent.threadId,
        "SELECT seq FROM transcript WHERE role = 'assistant'",
      );
      expect(replies).toHaveLength(calls.filter((call) => call.status === "done").length);
      const listed = await asLaptop(account, async (client) => await client.items.list({}));
      expect(listed.items).toHaveLength(1);
    },
  );

  it(
    "keeps an approval through a reset, and runs the delete once when the person allows it",
    { timeout: TURN_MS },
    async () => {
      const account = agentAccount();
      const itemId = await noteIn(account, "To go.");
      const sent = await send(account, script(`call delete_items {"ids":["${itemId}"]}`));
      await vi.waitFor(
        async () => {
          await expect(threadStatus(account, sent.threadId)).resolves.toBe("awaiting_approval");
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
      await expect(isDeleted(account, itemId)).resolves.toBe(true);
      const answered = await eventsOf(account, sent.threadId, "approval.answered");
      expect(answered.map(({ event }) => event)).toStrictEqual([
        expect.objectContaining({ by: "person", result: "allow" }),
      ]);
      const [tool] = await threadRows(
        account.accountId,
        sent.threadId,
        "SELECT attempts, is_error FROM tool_calls",
      );
      expect(tool).toStrictEqual({ attempts: 1, is_error: 0 });
      // a second answer decides nothing
      await threadOf(account.accountId, sent.threadId).respond({
        approved: false,
        reason: null,
        toolUseId: z.object({ toolUseId: z.string() }).parse(asked?.event).toolUseId,
      });
      await expect(
        threadRows(account.accountId, sent.threadId, "SELECT decision FROM tool_calls"),
      ).resolves.toStrictEqual([{ decision: "approved" }]);
    },
  );

  it("runs nothing the person denies, and says why", { timeout: TURN_MS }, async () => {
    const account = agentAccount();
    const itemId = await noteIn(account, "To keep.");
    const sent = await send(account, script(`call delete_items {"ids":["${itemId}"]}`));
    await vi.waitFor(
      async () => {
        await expect(eventsOf(account, sent.threadId, "approval.asked")).resolves.toHaveLength(1);
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
    await expect(isDeleted(account, itemId)).resolves.toBe(false);
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
          await expect(eventsOf(account, sent.threadId, "approval.asked")).resolves.toHaveLength(1);
        },
        { interval: 50, timeout: 10_000 },
      );
      const [asked] = await eventsOf(account, sent.threadId, "approval.asked");
      const { toolUseId } = z.object({ toolUseId: z.string() }).parse(asked?.event);
      const thread = threadOf(account.accountId, sent.threadId);
      // the ten minutes, passed: the job due now, and the alarm run
      await runInDurableObject(thread, async (object: AgentThreadDO) => {
        await expect(
          object.lifecycle.jobs.reschedule(`approval:${toolUseId}`, Date.now()),
        ).resolves.toBe(true);
      });
      await runDurableObjectAlarm(thread);
      await settled(account, sent.threadId);
      await expect(isDeleted(account, itemId)).resolves.toBe(false);
      const answered = await eventsOf(account, sent.threadId, "approval.answered");
      expect(answered.map(({ event }) => event)).toStrictEqual([
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
      expect(next).toStrictEqual({ status: "running", threadId: sent.threadId });
      await settled(account, sent.threadId);
      await expect(endingsOf(account, sent.threadId)).resolves.toStrictEqual([
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
          await expect(threadStatus(account, sent.threadId)).resolves.toBe("awaiting_approval");
        },
        { interval: 50, timeout: 10_000 },
      );
      await asLaptop(
        account,
        async (client) => await client.agent.cancel({ threadId: sent.threadId }),
      );
      await settled(account, sent.threadId);
      const answered = await eventsOf(account, sent.threadId, "approval.answered");
      expect(answered.map(({ event }) => event)).toStrictEqual([
        expect.objectContaining({ by: "cancel", result: "deny" }),
      ]);
      await send(account, script("Never mind."), sent.threadId);
      await settled(account, sent.threadId);
      await expect(endingsOf(account, sent.threadId)).resolves.toStrictEqual([
        { reason: "cancelled" },
        { reason: "done" },
      ]);
      await expect(isDeleted(account, itemId)).resolves.toBe(false);
    },
  );

  it(
    "streams two conversations at once, and a second send to one waits its turn",
    { timeout: TURN_MS },
    async () => {
      const account = agentAccount();
      // a roomy day, so the queue is what holds them
      const sendAs = async (text: string, threadId?: string) =>
        await send(account, text, threadId, ROOMY);
      const before = await heldSoFar();
      const first = await sendAs(script("stall"));
      const second = await sendAs(script("stall"));
      await heldMidReply(account, [first.threadId, second.threadId], before);
      // both held open at once, each in its own object
      for (const threadId of [first.threadId, second.threadId]) {
        const inspection = await threadOf(account.accountId, threadId).inspect();
        expect(inspection).toMatchObject({ driving: true, status: "running", turn: 1 });
      }
      await expect(sendAs(script("Wait for me."), first.threadId)).resolves.toStrictEqual({
        status: "queued",
        threadId: first.threadId,
      });
      // the account runs two at once: a third conversation waits for either
      const third = await sendAs(script("And me."));
      expect(third.status).toBe("queued");
      await expect(threadStatus(account, third.threadId)).resolves.toBe("queued");
      await asLaptop(account, async (client) => {
        await client.agent.cancel({ threadId: first.threadId });
        await client.agent.cancel({ threadId: second.threadId });
      });
      for (const threadId of [first.threadId, second.threadId, third.threadId]) {
        await settled(account, threadId);
      }
      // the stopped thread's waiting send went with its turn; the third opened once a turn sealed
      await expect(endingsOf(account, first.threadId)).resolves.toStrictEqual([
        { reason: "cancelled" },
      ]);
      await expect(endingsOf(account, third.threadId)).resolves.toStrictEqual([{ reason: "done" }]);
      // a stopped turn still counts: three turns taken
      const [usage] = await cellRows(account, "SELECT turns FROM agent_usage");
      expect(usage).toStrictEqual({ turns: 3 });
    },
  );

  it("ends a turn Claude refuses with the refusal's category", { timeout: TURN_MS }, async () => {
    const account = agentAccount();
    const sent = await send(account, script("refuse cyber"));
    await settled(account, sent.threadId);
    await expect(endingsOf(account, sent.threadId)).resolves.toStrictEqual([
      { detail: "cyber", reason: "refusal" },
    ]);
    // nothing of the declined reply is kept, and the conversation goes on
    const replies = await threadRows(
      account.accountId,
      sent.threadId,
      "SELECT seq FROM transcript WHERE role = 'assistant'",
    );
    expect(replies).toStrictEqual([]);
    await send(account, script("Something else."), sent.threadId);
    await settled(account, sent.threadId);
    await expect(endingsOf(account, sent.threadId)).resolves.toStrictEqual([
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
      await expect(endingsOf(account, sent.threadId)).resolves.toStrictEqual([{ reason: "done" }]);
      const messages = await eventsOf(account, sent.threadId, "agent.message");
      expect(messages.map(({ event }) => event)).toStrictEqual([
        { text: "Answered by the fallback model.", type: "agent.message" },
      ]);
      const [usage] = await cellRows(account, "SELECT cost_ucents FROM agent_usage");
      expect(usage?.cost_ucents).toBeGreaterThan(0);
      await send(account, script("Thanks."), sent.threadId);
      await settled(account, sent.threadId);
      await expect(endingsOf(account, sent.threadId)).resolves.toStrictEqual([
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
        await expect(run()).resolves.toStrictEqual(["continue", "later"]);
        await expect(run()).resolves.toStrictEqual(["later"]);
        // after 2 s, then 10 s, each a retry the drive job was timed for
        const [first = 0, second = 0] = asked.drives;
        expect(second - first).toBeGreaterThanOrEqual(8000);
        await expect(restsAt(run)).resolves.toBe("idle");
      });
      const calls = await callsOf(account, threadId);
      expect(calls.map((call) => call.status)).toStrictEqual(["failed", "failed", "done"]);
      expect(new Set(calls.map((call) => call.request_sha)).size).toBe(1);
      await expect(endingsOf(account, threadId)).resolves.toStrictEqual([{ reason: "done" }]);
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
          await expect(restsAt(run)).resolves.toBe("later");
        }
        await expect(restsAt(run)).resolves.toBe("idle");
        expect(asked.drives).toHaveLength(3);
      });
      await expect(endingsOf(account, threadId)).resolves.toStrictEqual([
        { detail: "status 529", reason: "unavailable" },
      ]);
      const [usage] = await cellRows(account, "SELECT turns, cost_ucents FROM agent_usage");
      expect(usage).toStrictEqual({ cost_ucents: 0, turns: 0 });
    },
  );

  it(
    "sends nothing for a turn stopped before its request goes, and still counts the turn",
    { timeout: TURN_MS },
    async () => {
      const account = agentAccount();
      const threadId = crypto.randomUUID();
      const before = await fakeStats();
      let stepped: ThreadHost | null = null;
      const digest = crypto.subtle.digest.bind(crypto.subtle);
      // the stop lands while the call's request is hashed, its abort registered, no stream open
      const hashing = vi.spyOn(crypto.subtle, "digest").mockImplementation(async (...args) => {
        if (stepped?.calls.has(1) === true) {
          requestCancel(stepped, 1);
        }
        return await digest(...args);
      });
      await inSteppedThread(account, threadId, script("Never sent."), async ({ host, run }) => {
        stepped = host;
        await expect(restsAt(run)).resolves.toBe("idle");
      });
      hashing.mockRestore();
      const calls = await callsOf(account, threadId);
      expect(calls.map((call) => [call.status, call.request_sha])).toStrictEqual([
        ["cancelled", null],
      ]);
      await expect(endingsOf(account, threadId)).resolves.toStrictEqual([{ reason: "cancelled" }]);
      const roles = await threadRows(account.accountId, threadId, "SELECT role FROM transcript");
      expect(roles).toStrictEqual([{ role: "user" }]);
      const after = await fakeStats();
      expect(after.requests).toBe(before.requests);
      const [usage] = await cellRows(account, "SELECT turns, cost_ucents FROM agent_usage");
      expect(usage).toStrictEqual({ cost_ucents: 0, turns: 1 });
    },
  );

  it(
    `ends a turn at its last step, after ${String(AGENT_MAX_STEPS)} replies, and the next turn goes on`,
    // twenty-one model calls in two turns, each a round trip through the fake
    { timeout: 3 * TURN_MS },
    async () => {
      const account = agentAccount();
      const threadId = crypto.randomUUID();
      const searches = Array.from(
        { length: AGENT_MAX_STEPS + 1 },
        (_, index) => `call search_library {"query":"step ${String(index)}"}`,
      );
      const before = await fakeStats();
      await inSteppedThread(account, threadId, script(...searches), async ({ deliver, run }) => {
        await expect(restsAt(async () => await run(4 * AGENT_MAX_STEPS))).resolves.toBe("idle");
        const asked = await fakeStats();
        expect(asked.requests - before.requests).toBe(AGENT_MAX_STEPS);
        await deliver(script("Go on."));
        await expect(restsAt(run)).resolves.toBe("idle");
      });
      await expect(endingsOf(account, threadId)).resolves.toStrictEqual([
        { reason: "budget" },
        { reason: "done" },
      ]);
      const transcript = await transcriptOf(account, threadId);
      const replies = transcript.filter((row) => row.turn === 1 && row.role === "assistant");
      expect(replies).toHaveLength(AGENT_MAX_STEPS);
      // every call the turn made answered, so the next request is valid
      expect(transcript.findLast((row) => row.turn === 1)?.role).toBe("user");
      await expectRepliesAskedAsKept(account, threadId);
    },
  );

  it(
    "cuts a reply silent for three minutes as a lost connection, and sends it again whole",
    { timeout: TURN_MS },
    async () => {
      const account = agentAccount();
      const threadId = crypto.randomUUID();
      const before = await heldSoFar();
      await inSteppedThread(account, threadId, script("stall"), async ({ host, run }) => {
        const resting = run();
        // the fake holds the reply mid-stream and sends nothing more
        await vi.waitFor(
          async () => {
            const { held } = await fakeStats();
            expect(held).toBe(before + 1);
          },
          { interval: 50, timeout: 10_000 },
        );
        const heardAt = host.calls.get(1)?.heardAt ?? 0;
        cutSilentCalls(host.calls, heardAt + 2 * MINUTE_MS);
        expect(host.calls.get(1)?.abort.signal.aborted).toBe(false);
        cutSilentCalls(host.calls, heardAt + 3 * MINUTE_MS);
        // a lost connection: sent again after the first retry's wait, not a stop
        await expect(resting).resolves.toStrictEqual(["continue", "later"]);
        await expect(restsAt(run)).resolves.toBe("idle");
      });
      const calls = await callsOf(account, threadId);
      expect(calls.map((call) => call.status)).toStrictEqual(["failed", "done"]);
      expect(new Set(calls.map((call) => call.request_sha)).size).toBe(1);
      await expect(endingsOf(account, threadId)).resolves.toStrictEqual([{ reason: "done" }]);
    },
  );

  it(
    "stops at once for a conversation deleted mid-reply, writing nothing and asking nothing more",
    { timeout: TURN_MS },
    async () => {
      const account = agentAccount();
      const threadId = crypto.randomUUID();
      const before = await fakeStats();
      await inSteppedThread(account, threadId, script("stall"), async ({ asked, host, run }) => {
        const resting = run();
        await vi.waitFor(
          async () => {
            const { held } = await fakeStats();
            expect(held).toBe(before.held + 1);
          },
          { interval: 50, timeout: 10_000 },
        );
        await host.purge();
        await expect(resting).resolves.toStrictEqual(["continue", "purged"]);
        await expect(run()).resolves.toStrictEqual([]);
        expect(asked.drives).toStrictEqual([]);
      });
      const after = await fakeStats();
      expect(after.requests).toBe(before.requests + 1);
      await expect(threadHolds(account.accountId, threadId)).resolves.toBe(false);
    },
  );

  it(
    "hears a reply as its bytes arrive, so one still streaming is never cut",
    // the fake streams 4,000 characters slowly on purpose, and the wait for its bytes allows 10 s
    { timeout: TURN_MS },
    async () => {
      const account = agentAccount();
      const threadId = crypto.randomUUID();
      await inSteppedThread(account, threadId, script("long 4000"), async ({ host, run }) => {
        const resting = run();
        let first: number | null = null;
        await vi.waitFor(
          () => {
            const heardAt = host.calls.get(1)?.heardAt;
            first ??= heardAt ?? null;
            expect(heardAt ?? 0).toBeGreaterThan((first ?? Infinity) + 250);
          },
          { interval: 25, timeout: 10_000 },
        );
        await expect(resting).resolves.toStrictEqual(["continue", "continue", "idle"]);
      });
      const calls = await callsOf(account, threadId);
      expect(calls.map((call) => call.status)).toStrictEqual(["done"]);
    },
  );

  it(
    "takes up a deploy's definition at the next turn's start, never mid-turn, replaying no thinking from before it and the filing rules again",
    // nine model calls in four turns, each a round trip through the fake
    { timeout: 2 * TURN_MS },
    async () => {
      const account = agentAccount();
      const threadId = crypto.randomUUID();
      const rules = "File trips under Travel.";
      await rulesIn(account, rules);
      const first = deployedDefinition();
      // a deploy that changes the prompt and a tool's words, and another after it
      const redeployed = (words: string): ThreadDefinition => ({
        ...first,
        system: [...first.system, { text: words, type: "text" }],
        tools: first.tools.map((tool, index) =>
          index === 0 ? { ...tool, description: `${tool.description ?? ""} ${words}` } : tool,
        ),
      });
      const second = redeployed("Second deploy.");
      const third = redeployed("Third deploy.");
      let deployed = first;
      await inSteppedThread(
        account,
        threadId,
        script('call create_note {"markdown":"One."}', 'call search_library {"query":"One"}'),
        async ({ deliver, run, sent }) => {
          await expect(restsAt(run)).resolves.toBe("idle");
          const firstTurn = sent.length;
          // deployed between two turns: the next turn is sent under it from its first call
          deployed = second;
          await deliver(script('call search_library {"query":"Two"}'));
          await expect(restsAt(run)).resolves.toBe("idle");
          const secondTurn = sent.slice(firstTurn);
          for (const body of secondTurn) {
            expect(definitionSent(body)).toStrictEqual(sentAs(second));
          }
          // no thinking block of the turns before it, every reply of theirs still there, and the
          // filing rules sent again last, since what the turn's requests leave out may have taken
          // the message they last went in
          const [opening = ""] = secondTurn;
          const openingTypes = blockTypesOf(unmarkedOf(opening));
          expect(openingTypes.flat()).not.toContain("thinking");
          expect(openingTypes).toStrictEqual([
            ["text"],
            ["text"],
            ["tool_use"],
            ["tool_result"],
            ["tool_use"],
            ["tool_result"],
            ["text"],
            ["text"],
            ["text"],
          ]);
          expect(unmarkedOf(opening).messages.at(-1)).toStrictEqual({
            content: rulesMessage(rules),
            role: "system",
          });
          expectSharedPrefixes(secondTurn);
          // deployed mid-turn: the turn ends under the definition it started under
          await deliver(
            script('call create_note {"markdown":"Three."}', 'call search_library {"query":"3"}'),
          );
          const beforeThird = sent.length;
          await expect(run(2)).resolves.toStrictEqual(["continue", "continue"]);
          deployed = third;
          await expect(restsAt(run)).resolves.toBe("idle");
          const thirdTurn = sent.slice(beforeThird);
          expect(thirdTurn).toHaveLength(3);
          for (const body of thirdTurn) {
            expect(definitionSent(body)).toStrictEqual(sentAs(second));
          }
          expectSharedPrefixes(sent.slice(firstTurn));
          const beforeFourth = sent.length;
          await deliver(script("Thanks."));
          await expect(restsAt(run)).resolves.toBe("idle");
          for (const body of sent.slice(beforeFourth)) {
            expect(definitionSent(body)).toStrictEqual(sentAs(third));
            expect(blockTypesOf(unmarkedOf(body)).flat()).not.toContain("thinking");
          }
        },
        { definition: () => deployed },
      );
      // nothing refused, nothing dropped (afterEach), every turn done
      await expect(endingsOf(account, threadId)).resolves.toStrictEqual([
        { reason: "done" },
        { reason: "done" },
        { reason: "done" },
        { reason: "done" },
      ]);
      // each definition in force from the first row of the turn that took it up
      const firstRows = await threadRows(
        account.accountId,
        threadId,
        "SELECT min(seq) AS seq FROM transcript GROUP BY turn ORDER BY turn",
      );
      const starts = firstRows.map((row) => z.object({ seq: z.number() }).parse(row).seq);
      const definitions = await definitionsOf(account, threadId);
      expect(definitions.map((definition) => definition.since_seq)).toStrictEqual([
        starts[0],
        starts[1],
        starts[3],
      ]);
      // the rules kept with the first reply of each turn that took up a definition, and of no other
      const transcript = await transcriptOf(account, threadId);
      const rolesOf = (turn: number) =>
        transcript.filter((row) => row.turn === turn).map((row) => row.role);
      expect(rolesOf(1).slice(0, 3)).toStrictEqual(["user", "system", "assistant"]);
      expect(rolesOf(2).slice(0, 3)).toStrictEqual(["user", "system", "assistant"]);
      expect(rolesOf(3)).not.toContain("system");
      expect(rolesOf(4)).toStrictEqual(["user", "system", "assistant"]);
      await expectRepliesAskedAsKept(account, threadId);
    },
  );

  it(
    "tells a conversation taking up a deploy's definition that its filing rules are cleared",
    { timeout: TURN_MS },
    async () => {
      const account = agentAccount();
      const threadId = crypto.randomUUID();
      await rulesIn(account, "File trips under Travel.");
      const first = deployedDefinition();
      let deployed = first;
      await inSteppedThread(
        account,
        threadId,
        script("Noted."),
        async ({ deliver, run }) => {
          await expect(restsAt(run)).resolves.toBe("idle");
          deployed = { ...first, system: [...first.system, { text: "A deploy.", type: "text" }] };
          // a stub made here, inside the thread's object, which may not use one made outside it
          await rulesIn({ ...account, cell: cellOf(account.accountId) }, "");
          await deliver(script("Cleared."));
          await expect(restsAt(run)).resolves.toBe("idle");
        },
        { definition: () => deployed },
      );
      const transcript = await transcriptOf(account, threadId);
      expect(
        transcript.flatMap((row) =>
          row.role === "system" ? [[row.turn, z.json().parse(JSON.parse(row.content))]] : [],
        ),
      ).toStrictEqual([
        [1, rulesMessage("File trips under Travel.")],
        [2, rulesMessage(RULES_CLEARED)],
      ]);
      await expectRepliesAskedAsKept(account, threadId);
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
        await expect(restsAt(run)).resolves.toBe("later");
        await expect(restsAt(run)).resolves.toBe("idle");
      },
      {
        cell: (real) => ({
          ...real,
          agentPreview: real.agentPreview,
          agentPush: real.agentPush,
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
    expect(tool).toStrictEqual({ attempts: 2, is_error: 0, status: "done" });
    const listed = await asLaptop(account, async (client) => await client.items.list({}));
    expect(listed.items).toHaveLength(1);
    await expect(endingsOf(account, threadId)).resolves.toStrictEqual([{ reason: "done" }]);
  });
});
