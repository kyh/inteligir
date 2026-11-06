// The built-in agent's turns as the account's cell keeps them: a send let in, refused or queued in
// one transaction; the calls a conversation's object makes back refused for a thread the cell does
// not hold or a turn not open; each push landed once by its sequence, its events told to the
// sockets once it commits; the seal, one change set Undo takes back, a turn that cost nothing given
// back, a cut call booked at what it reserved and a link the turn saved read only then; the
// switch; and a thread's or the account's deletion taking each conversation's object with it.

import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { LibrarySocketFrame } from "@repo/contract/cloud/library/library-socket";
import { openCellLibrary } from "../library/cell-library";
import { cellStorageOf } from "../library/cell-storage";
import { ACCOUNT_PURGE_STEPS } from "../library/account-purge";
import {
  agentAccount,
  asLaptop,
  cellRows,
  fakeStats,
  heldMidReply,
  heldSoFar,
  script,
  settled,
  threadHolds,
  threadOf,
  threadRows,
  threadStatus,
} from "../test-support/agent-turns";
import type { AgentAccount } from "../test-support/agent-turns";
import { agentCellIn, inCell } from "../test-support/library-cell";
import { openTurnInCell } from "../test-support/thread-host";
import { dayOf, nextDayAt, UCENTS_PER_CENT } from "./agent-allowance";
import type { AgentThreadDO } from "./agent-thread";
import { landPush, reserveForCall, runAgentJobs, showPreview } from "./agent-turns";
import { AGENT_MODEL } from "./library-agent";
import type { PushRequest } from "./thread-wire";
import { isOrpcError } from "@repo/contract/cloud/v1/errors";

// a turn's end can take a few model calls, each a round trip through the fake
const TURN_MS = 30_000;

const refusalOf = async (call: Promise<unknown>) => {
  try {
    await call;
  } catch (error) {
    if (isOrpcError(error)) {
      return { code: error.code, data: error.data };
    }
    throw error;
  }
  throw new Error("the call was answered");
};

const send = async (account: AgentAccount, text: string, threadId?: string) =>
  await asLaptop(account, async (client) => await client.agent.send({ text, threadId }));

// what today's ledger already booked, as if earlier turns had spent it
const spentToday = async (account: AgentAccount, cents: number): Promise<void> => {
  await cellRows(
    account,
    `INSERT INTO agent_usage (day, turns, input_tokens, cache_read_tokens, cache_write_5m_tokens,
       cache_write_1h_tokens, output_tokens, cost_ucents)
     VALUES (?, 0, 0, 0, 0, 0, 0, ?)`,
    dayOf(Date.now()),
    cents * UCENTS_PER_CENT,
  );
};

const usageSchema = z.object({ cost_ucents: z.number(), turns: z.number() });

const usageToday = async (account: AgentAccount) => {
  const [row] = await cellRows(account, "SELECT turns, cost_ucents FROM agent_usage");
  return row === undefined ? { cost_ucents: 0, turns: 0 } : usageSchema.parse(row);
};

const endedSchema = z.object({ json: z.string() });

const endingsOf = async (account: AgentAccount, threadId: string) => {
  const rows = await cellRows(
    account,
    "SELECT json FROM thread_events WHERE thread_id = ? AND type = 'turn.ended' ORDER BY idx",
    threadId,
  );
  return rows.map((row) =>
    z.object({ reason: z.string() }).parse(JSON.parse(endedSchema.parse(row).json)),
  );
};

// the object's instance gone, its tables of another version, and nothing left to wake it: what a
// deploy that changes the thread's tables leaves, which the next instance's start wipes
const startsOver = async (account: AgentAccount, threadId: string): Promise<void> => {
  const thread = threadOf(account.accountId, threadId);
  // committed before the reset, which drops what its own call wrote
  await runInDurableObject(thread, async (_thread: AgentThreadDO, state) => {
    state.storage.sql.exec("UPDATE meta SET v = '0' WHERE k = 'schema'");
    await state.storage.deleteAlarm();
  });
  await expect(
    runInDurableObject(thread, (_thread: AgentThreadDO, state) => {
      state.abort("the object was reset");
    }),
  ).rejects.toThrow("the object was reset");
};

// the cell's watch, five minutes on: it asks after a turn its object has been quiet about
const watchedLater = async (account: AgentAccount): Promise<void> => {
  await inCell(account.cell, async (state) => {
    const later = { now: Date.now() + 6 * 60_000 };
    await runAgentJobs(agentCellIn(state, openCellLibrary(state, env), { clock: later }));
  });
};

afterEach(async () => {
  const stats = await fakeStats();
  expect(stats.drops).toBe(0);
});

describe("a send to the built-in agent", () => {
  it(
    "is refused once the day's turns are taken, saying when the day fills again",
    { timeout: TURN_MS },
    async () => {
      const account = agentAccount();
      for (const words of ["One.", "Two."]) {
        const sent = await send(account, script(words));
        await settled(account, sent.threadId);
      }
      const refused = await refusalOf(send(account, script("Three.")));
      expect(refused).toStrictEqual({
        code: "AGENT_BUDGET",
        data: { resetsAt: nextDayAt(Date.now()) },
      });
      await expect(usageToday(account)).resolves.toMatchObject({ turns: 2 });
    },
  );

  it("is refused once the day's list cost is spent", async () => {
    const account = agentAccount();
    await spentToday(account, 100);
    const refused = await refusalOf(send(account, script("Anything?")));
    expect(refused).toMatchObject({ code: "AGENT_BUDGET" });
    const threads = await cellRows(account, "SELECT id FROM threads");
    expect(threads).toStrictEqual([]);
  });

  it("is refused, counted against nothing, while the agent is off or this deployment has no Claude", async () => {
    const account = agentAccount();
    await asLaptop(account, async (client) => {
      await expect(client.agent.setEnabled({ enabled: false })).resolves.toStrictEqual({
        enabled: false,
      });
      await expect(refusalOf(client.agent.send({ text: "Hello?" }))).resolves.toMatchObject({
        code: "SERVICE_UNAVAILABLE",
      });
      await expect(client.agent.status()).resolves.toMatchObject({ enabled: false, turnsLeft: 2 });
      await client.agent.setEnabled({ enabled: true });
    });
    const unconfigured: Env = { ...env, AGENT_GATEWAY_URL: "", ANTHROPIC_FAKE_URL: undefined };
    const refused = await asLaptop(
      account,
      async (client) => await refusalOf(client.agent.send({ text: "Hello?" })),
      { env: unconfigured },
    );
    expect(refused).toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    await expect(usageToday(account)).resolves.toStrictEqual({ cost_ucents: 0, turns: 0 });
    await expect(cellRows(account, "SELECT id FROM threads")).resolves.toStrictEqual([]);
  });

  it("waits behind its thread's open turn, and while the account runs as many as it may", async () => {
    const account = agentAccount();
    const roomy: Env = {
      ...env,
      AGENT_ALLOWANCE: { concurrentTurns: 2, dayCents: 100, dayTurns: 10, turnCents: 50 },
    };
    // two turns open, as two sends left them, their objects not yet handed them
    const [busy, other] = [crypto.randomUUID(), crypto.randomUUID()];
    await openTurnInCell(account, busy, "Busy.");
    await openTurnInCell(account, other, "Also busy.");
    const sendAs = async (text: string, threadId?: string) =>
      await asLaptop(account, async (client) => await client.agent.send({ text, threadId }), {
        env: roomy,
      });
    await expect(sendAs("Behind the first.", busy)).resolves.toStrictEqual({
      status: "queued",
      threadId: busy,
    });
    // its thread still shows the turn that runs
    await expect(threadStatus(account, busy)).resolves.toBe("running");
    const fresh = await sendAs("A new conversation.");
    expect(fresh.status).toBe("queued");
    await expect(threadStatus(account, fresh.threadId)).resolves.toBe("queued");
    const queued = await cellRows(account, "SELECT thread_id FROM agent_queue ORDER BY queued_at");
    expect(queued).toStrictEqual([{ thread_id: busy }, { thread_id: fresh.threadId }]);
    // a waiting send is a turn taken
    const status = await asLaptop(account, async (client) => await client.agent.status(), {
      env: roomy,
    });
    expect(status.turnsLeft).toBe(10 - 2 - 2);
  });
});

describe("what a conversation's object asks of its cell", () => {
  it("refuses a thread the cell does not hold and a turn that is not open", async () => {
    const account = agentAccount();
    const threadId = crypto.randomUUID();
    const call = { input: {}, name: "list_items", toolUseId: "toolu_1" };
    await expect(account.cell.agentTool({ ...call, threadId, turn: 1 })).resolves.toStrictEqual({
      ok: false,
      refusal: "unknown-thread",
    });
    await openTurnInCell(account, threadId, "Open.");
    await expect(account.cell.agentTool({ ...call, threadId, turn: 2 })).resolves.toStrictEqual({
      ok: false,
      refusal: "turn-closed",
    });
    const reserve = {
      callId: `${threadId}:2:0:0`,
      estimate: { frozenTokens: 100, previous: null, promptTokens: 200 },
      model: AGENT_MODEL.id,
      resend: null,
      threadId,
      turn: 2,
    };
    await expect(account.cell.agentReserve(reserve)).resolves.toStrictEqual({
      ok: false,
      refusal: "turn-closed",
    });
    await expect(
      account.cell.agentPreview({ text: "Hi", threadId: crypto.randomUUID(), turn: 1 }),
    ).resolves.toStrictEqual({ ok: false, refusal: "unknown-thread" });
    const ran = await account.cell.agentTool({ ...call, threadId, turn: 1 });
    expect(ran).toMatchObject({ ok: true, value: { isError: false } });
  });

  it(
    "refuses a tool call once the turn sealed, so nothing lands after it",
    { timeout: TURN_MS },
    async () => {
      const account = agentAccount();
      const sent = await send(account, script("Nothing to do."));
      await settled(account, sent.threadId);
      await expect(
        account.cell.agentTool({
          input: { markdown: "Too late." },
          name: "create_note",
          threadId: sent.threadId,
          toolUseId: "toolu_late",
          turn: 1,
        }),
      ).resolves.toStrictEqual({ ok: false, refusal: "turn-closed" });
      const listed = await asLaptop(account, async (client) => await client.items.list({}));
      expect(listed.items).toStrictEqual([]);
    },
  );

  it("lands a push once by its sequence, and tells each event to the sockets after it commits", async () => {
    const account = agentAccount();
    const threadId = crypto.randomUUID();
    await openTurnInCell(account, threadId, "Open.");
    const frames: LibrarySocketFrame[] = [];
    await inCell(account.cell, async (state) => {
      const cell = agentCellIn(state, openCellLibrary(state, env), { frames });
      const push: PushRequest = {
        entries: [{ event: { text: "Said once.", type: "agent.message" }, kind: "event" }],
        seq: 1,
        threadId,
        turn: 1,
      };
      await expect(landPush(cell, push)).resolves.toStrictEqual({ ok: true, value: null });
      await expect(landPush(cell, push)).resolves.toStrictEqual({ ok: true, value: null });
      expect(showPreview(cell, { text: "Said on", threadId, turn: 1 })).toStrictEqual({
        ok: true,
        value: null,
      });
    });
    const events = await cellRows(
      account,
      "SELECT event_id, type FROM thread_events WHERE thread_id = ? ORDER BY idx",
      threadId,
    );
    expect(events).toStrictEqual([{ event_id: `${threadId}:1:0`, type: "agent.message" }]);
    expect(frames).toStrictEqual([
      {
        event: { text: "Said once.", type: "agent.message" },
        preview: false,
        threadId,
        type: "thread",
      },
      {
        event: { text: "Said on", type: "agent.preview" },
        preview: true,
        threadId,
        type: "thread",
      },
    ]);
  });

  it("books a cut call at what it reserved, and gives back a turn that cost nothing", async () => {
    const account = agentAccount();
    const [cutThread, freeThread] = [crypto.randomUUID(), crypto.randomUUID()];
    await openTurnInCell(account, cutThread, "Cut.");
    await openTurnInCell(account, freeThread, "Free.");
    const estimate = { frozenTokens: 1000, previous: null, promptTokens: 2000 };
    await inCell(account.cell, async (state) => {
      const cell = agentCellIn(state, openCellLibrary(state, env));
      for (const threadId of [cutThread, freeThread]) {
        const reserved = reserveForCall(cell, {
          callId: `${threadId}:1:0:0`,
          estimate,
          model: AGENT_MODEL.id,
          resend: null,
          threadId,
          turn: 1,
        });
        expect(reserved).toMatchObject({ ok: true, value: { kind: "granted" } });
      }
      for (const [threadId, outcome] of [
        [cutThread, "cut"],
        [freeThread, "free"],
      ] as const) {
        await landPush(cell, {
          entries: [
            { callId: `${threadId}:1:0:0`, kind: "call", outcome },
            { event: { reason: "unavailable", turn: 1, type: "turn.ended" }, kind: "event" },
          ],
          seq: 1,
          threadId,
          turn: 1,
        });
      }
    });
    const calls = await cellRows(
      account,
      "SELECT thread_id, reserved_ucents, cost_ucents, cut FROM agent_calls",
    );
    const cut = calls.find((call) => call.thread_id === cutThread);
    expect(cut?.cost_ucents).toBe(cut?.reserved_ucents);
    expect(cut?.cut).toBe(1);
    expect(calls.find((call) => call.thread_id === freeThread)).toMatchObject({
      cost_ucents: 0,
      cut: 0,
    });
    // both turns sealed; the one that cost nothing was given back
    await expect(cellRows(account, "SELECT thread_id FROM agent_turns")).resolves.toStrictEqual([]);
    const usage = await usageToday(account);
    expect(usage).toStrictEqual({ cost_ucents: cut?.reserved_ucents, turns: 1 });
  });

  it(
    "ends a turn whose call the allowance cannot reserve, sending nothing, and gives it back",
    { timeout: TURN_MS },
    async () => {
      const account = agentAccount();
      // a cent of the day left: a send is let in, and its first call buys too little to answer
      await spentToday(account, 99);
      const before = await fakeStats();
      const sent = await send(account, script("Go on."));
      await settled(account, sent.threadId);
      await expect(endingsOf(account, sent.threadId)).resolves.toStrictEqual([
        { reason: "budget" },
      ]);
      const after = await fakeStats();
      expect(after.requests).toBe(before.requests);
      await expect(usageToday(account)).resolves.toStrictEqual({
        cost_ucents: 99 * UCENTS_PER_CENT,
        turns: 0,
      });
      // the conversation goes on from there the next time the day allows
      await expect(threadStatus(account, sent.threadId)).resolves.toBe("idle");
    },
  );
});

describe("a turn's seal", () => {
  it(
    "makes the turn's writes one change set, which Undo takes back whole",
    { timeout: TURN_MS },
    async () => {
      const account = agentAccount();
      const sent = await send(
        account,
        script('call create_note {"markdown":"Paris."}', 'call create_note {"markdown":"Rome."}'),
      );
      await settled(account, sent.threadId);
      await asLaptop(account, async (client) => {
        const listed = await client.items.list({});
        expect(listed.items).toHaveLength(2);
        const history = await client.history.list({});
        const sets = history.changeSets.filter((set) => set.label === "Agent");
        expect(sets).toHaveLength(1);
        await client.history.undo({ changeSetIds: [sets[0]?.id ?? ""] });
        const undone = await client.items.list({});
        expect(undone.items).toStrictEqual([]);
      });
    },
  );

  it(
    "lists one conversation's sets, by the turn that made each, and refuses an item beside it",
    { timeout: TURN_MS },
    async () => {
      // the day's allowance in the suites is two turns: one a conversation
      const account = agentAccount();
      const first = await send(account, script('call create_note {"markdown":"Paris."}'));
      await settled(account, first.threadId);
      const other = await send(account, script('call create_note {"markdown":"Oslo."}'));
      await settled(account, other.threadId);
      await asLaptop(account, async (client) => {
        const everything = await client.history.list({});
        expect(everything.changeSets.filter((set) => set.actor === "agent")).toHaveLength(2);
        const { changeSets } = await client.history.list({ threadId: first.threadId });
        expect(changeSets.map((set) => [set.threadId, set.turn])).toStrictEqual([
          [first.threadId, 1],
        ]);
        const [made] = changeSets[0]?.items ?? [];
        expect(made).toBeDefined();
        const both = await refusalOf(
          client.history.list({ itemId: made?.id ?? "", threadId: first.threadId }),
        );
        expect(both.code).toBe("BAD_REQUEST");
      });
    },
  );

  it("reads a link the agent saved only once its turn seals", { timeout: TURN_MS }, async () => {
    const account = agentAccount();
    const sent = await send(
      account,
      script('call save_link {"url":"https://example.com/held"}', "stall"),
    );
    // the link saved, the closing reply held open: the turn has not sealed
    await vi.waitFor(
      async () => {
        const held = await cellRows(
          account,
          "SELECT payload, next_at FROM jobs WHERE kind = 'fill'",
        );
        expect(held).toHaveLength(1);
      },
      { interval: 50, timeout: 10_000 },
    );
    const [held] = await cellRows(account, "SELECT payload, next_at FROM jobs WHERE kind = 'fill'");
    const payload = z
      .object({ heldBy: z.string(), url: z.string() })
      .parse(JSON.parse(z.string().parse(held?.payload)));
    expect(payload.url).toBe("https://example.com/held");
    expect(z.number().parse(held?.next_at)).toBeGreaterThan(Date.now() + 60 * 60_000);
    const set = await cellRows(
      account,
      "SELECT sealed_at FROM change_sets WHERE id = ?",
      payload.heldBy,
    );
    expect(set).toStrictEqual([{ sealed_at: null }]);
    // the turn stopped and sealed, and the reading sent with the seal's commit
    await asLaptop(
      account,
      async (client) => await client.agent.cancel({ threadId: sent.threadId }),
    );
    await settled(account, sent.threadId);
    await expect(
      cellRows(account, "SELECT id FROM jobs WHERE kind = 'fill'"),
    ).resolves.toStrictEqual([]);
  });
});

describe("the switch and deletion", () => {
  it(
    "stops every open turn when the agent is turned off, and lets sends in again when it is on",
    { timeout: TURN_MS },
    async () => {
      const account = agentAccount();
      const sent = await send(account, script("stall"));
      await vi.waitFor(
        async () => {
          await expect(threadStatus(account, sent.threadId)).resolves.toBe("running");
        },
        { interval: 50, timeout: 10_000 },
      );
      await asLaptop(account, async (client) => {
        await client.agent.setEnabled({ enabled: false });
      });
      // the alarm hands the stop to the thread's object
      await runDurableObjectAlarm(account.cell);
      await settled(account, sent.threadId);
      await expect(endingsOf(account, sent.threadId)).resolves.toStrictEqual([
        { reason: "cancelled" },
      ]);
      await asLaptop(account, async (client) => {
        const events = await client.agent.events({ threadId: sent.threadId });
        expect(events.events.length).toBeGreaterThan(0);
        await client.agent.setEnabled({ enabled: true });
      });
      const again = await send(account, script("Back."), sent.threadId);
      expect(again.status).toBe("running");
      await settled(account, sent.threadId);
    },
  );

  it(
    "wakes an open turn its object has been quiet about for five minutes",
    { timeout: TURN_MS },
    async () => {
      const account = agentAccount();
      const before = await heldSoFar();
      const sent = await send(account, script("stall"));
      await heldMidReply(account, [sent.threadId], before);
      // the object's instance gone with nothing left to wake it: no alarm, no call
      await expect(
        runInDurableObject(
          threadOf(account.accountId, sent.threadId),
          async (_thread: AgentThreadDO, state) => {
            await state.storage.deleteAlarm();
            state.abort("the object was reset");
          },
        ),
      ).rejects.toThrow("the object was reset");
      // five minutes on, the cell's watch asks after it, which starts a fresh instance
      await watchedLater(account);
      await settled(account, sent.threadId);
      await expect(endingsOf(account, sent.threadId)).resolves.toStrictEqual([{ reason: "done" }]);
      await expect(
        cellRows(account, "SELECT id FROM jobs WHERE kind IN ('agent-deliver', 'agent-watch')"),
      ).resolves.toStrictEqual([]);
    },
  );

  it(
    "lands every push of an object that started over between turns",
    { timeout: TURN_MS },
    async () => {
      const account = agentAccount();
      const sent = await send(account, script("Before."));
      await settled(account, sent.threadId);
      await startsOver(account, sent.threadId);
      await send(account, script("After."), sent.threadId);
      await settled(account, sent.threadId);
      await expect(endingsOf(account, sent.threadId)).resolves.toStrictEqual([
        { reason: "done" },
        { reason: "done" },
      ]);
      // the conversation went with the old tables: the object holds the second turn alone
      await expect(
        threadRows(account.accountId, sent.threadId, "SELECT turn, role FROM transcript"),
      ).resolves.toStrictEqual([
        { role: "user", turn: 2 },
        { role: "assistant", turn: 2 },
      ]);
    },
  );

  it(
    "hands a turn again to an object that started over in the middle of it",
    { timeout: TURN_MS },
    async () => {
      const account = agentAccount();
      const before = await heldSoFar();
      const sent = await send(account, script("stall"));
      await heldMidReply(account, [sent.threadId], before);
      await startsOver(account, sent.threadId);
      // the watch's ask starts a fresh instance, which holds the turn no more, and is handed it
      await watchedLater(account);
      await settled(account, sent.threadId);
      await expect(endingsOf(account, sent.threadId)).resolves.toStrictEqual([{ reason: "done" }]);
      await expect(
        threadRows(account.accountId, sent.threadId, "SELECT turn, role FROM transcript"),
      ).resolves.toStrictEqual([
        { role: "user", turn: 1 },
        { role: "assistant", turn: 1 },
      ]);
    },
  );

  it("deletes a thread with everything its object keeps", { timeout: TURN_MS }, async () => {
    const account = agentAccount();
    const sent = await send(account, script("Remember this."));
    await settled(account, sent.threadId);
    await expect(threadHolds(account.accountId, sent.threadId)).resolves.toBe(true);
    await asLaptop(account, async (client) => {
      await expect(client.agent.delete({ threadId: sent.threadId })).resolves.toStrictEqual({
        deleted: true,
      });
    });
    await expect(threadHolds(account.accountId, sent.threadId)).resolves.toBe(false);
    await expect(cellRows(account, "SELECT id FROM threads")).resolves.toStrictEqual([]);
    await expect(cellRows(account, "SELECT event_id FROM thread_events")).resolves.toStrictEqual(
      [],
    );
  });

  it(
    "purges every conversation's object with the account, before the cell's own rows",
    { timeout: TURN_MS },
    async () => {
      const account = agentAccount();
      const threads: string[] = [];
      for (const words of ["First.", "Second."]) {
        const sent = await send(account, script(words));
        await settled(account, sent.threadId);
        threads.push(sent.threadId);
      }
      const [tombstone, agent] = ACCOUNT_PURGE_STEPS;
      expect(agent?.name).toBe("agent");
      await inCell(account.cell, async (state) => {
        const scope = { accountId: account.accountId, ctx: state, email: "gone@example.test", env };
        await tombstone?.run(scope);
        await agent?.run(scope);
        // the cell's own rows are still there: the next step takes them
        const rows = cellStorageOf(state.storage).all("SELECT id FROM threads", []);
        expect(rows).toHaveLength(2);
      });
      for (const threadId of threads) {
        await expect(threadHolds(account.accountId, threadId)).resolves.toBe(false);
      }
    },
  );
});
