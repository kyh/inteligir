import type { V1Client } from "@repo/contract/cloud/v1";
import { z } from "zod";
import { expect, expectEq } from "../harness/assert";
import { OWNER, signUp } from "../harness/cloud-account";
import type { CloudWorker } from "../harness/cloud-worker";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { v1Client } from "../harness/v1-wire";

const DEADLINE_MS = 60_000;

// a day that holds every turn the scenario runs, two at once, each turn capped at 50 cents
const ALLOWANCE = { concurrentTurns: 2, dayCents: 1000, dayTurns: 20, turnCents: 50 };

// what one read of the long note adds to the conversation, past which the turn's 50 cents run out
// within the reads the script asks for
const LONG_NOTE_WORDS = 2000;
const READS = 16;

type Library = V1Client["library"];
type ThreadStatus = Awaited<ReturnType<Library["agent"]["list"]>>["threads"][number]["status"];

// the stored events this scenario reads: their type, the call an approval waits on, how a turn
// ended and how an approval was answered
const storedEventSchema = z.looseObject({
  reason: z.string().optional(),
  result: z.string().optional(),
  type: z.string(),
});

// the thread's stored events, of one type when it is named
const eventsOf = async (library: Library, threadId: string, type?: string) => {
  const { events } = await library.agent.events({ threadId, limit: 500 });
  const stored = events.map((row) => ({
    event: storedEventSchema.parse(row.event),
    eventId: row.eventId,
  }));
  return type === undefined ? stored : stored.filter(({ event }) => event.type === type);
};

// the thread as the account lists it, once it reaches the status the turn leaves it in
const untilStatus = async (
  library: Library,
  threadId: string,
  status: ThreadStatus,
): Promise<void> => {
  await pollUntil(
    async () => {
      const { threads } = await library.agent.list({});
      return threads.find((thread) => thread.id === threadId)?.status ?? null;
    },
    (current) => current === status,
    {
      deadlineMs: DEADLINE_MS,
      describe: (current) => `thread ${threadId} is ${String(current)}, not ${status}`,
    },
  );
};

// how each of the thread's turns ended, in order
const endingsOf = async (library: Library, threadId: string): Promise<string[]> => {
  const ended = await eventsOf(library, threadId, "turn.ended");
  return ended.map(({ event }) => event.reason ?? "");
};

// the agent's change sets, newest first
const agentSets = async (library: Library) => {
  const { changeSets } = await library.history.list({});
  return changeSets.filter((set) => set.actor === "agent");
};

// the approval a paused turn asks the person for, by the event that asked
const askedCall = async (library: Library, threadId: string): Promise<string> => {
  const asked = await eventsOf(library, threadId, "approval.asked");
  const last = asked.at(-1);
  expect(last !== undefined, `the paused turn asked about nothing`);
  return last.eventId;
};

const deleteDirective = (id: string): string =>
  `call delete_items ${JSON.stringify({ ids: [id] })}`;

const isDeleted = async (library: Library, id: string): Promise<boolean> => {
  const { fields } = await library.items.read({ id });
  return fields.deletedAt !== null;
};

const statsSchema = z.object({ drops: z.number(), requests: z.number() });

// the scripted API's counters: the requests it answered, and the replayed thinking blocks it
// dropped, each one a request the thread got wrong
const fakeStats = async (worker: CloudWorker) => {
  const response = await fetch(`${worker.messagesOrigin}/__fake/stats`);
  return statsSchema.parse(await response.json());
};

export const agentCell: Scenario = {
  description:
    "the built-in agent's turns in a Miniflare Worker's library cell and each conversation's own object, against a scripted Claude: a turn's two notes land in one change set an undo takes back whole; a deletion the agent asks for waits for the person, and runs when allowed and not when denied; cancelling a turn that keeps working stops it; a turn whose next call the allowance cannot reserve ends there, and the next send goes on in the same conversation; a conversation the API compacts goes on from the compaction, telling a progress note before each tool call; and Claude never drops a replayed thinking block",
  name: "agent-cell",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const worker = await ctx.cloudWorker({ json: { AGENT_ALLOWANCE: ALLOWANCE } });
    await signUp(worker.origin);
    const phone = await v1Client(worker, null).account.signIn({
      ...OWNER,
      deviceName: "E2E Phone",
    });
    const { library } = v1Client(worker, phone.credential);

    ctx.log("the agent is on from the start: there is nothing to make for it");
    const before = await library.agent.status();
    expectEq(before.enabled, true, "the switch before the person touches it");

    ctx.log("one turn makes two notes, in one change set an undo takes back whole");
    const first = await library.agent.send({
      text: 'Make two notes.\ncall create_note {"markdown":"Paris"}\ncall create_note {"markdown":"Lyon"}',
    });
    expectEq(first.status, "running", "the first turn's status");
    await untilStatus(library, first.threadId, "idle");
    const [made, ...older] = await agentSets(library);
    expect(made !== undefined && older.length === 0, "the turn left no change set of its own");
    expectEq(
      { closed: made.closedAt !== null, count: made.itemCount, label: made.label },
      { closed: true, count: 2, label: "Agent" },
      "the turn's change set",
    );
    const madeIds = made.items.map((item) => item.id).toSorted();
    const undone = await library.history.undo({ changeSetIds: [made.id] });
    expectEq(undone.reverted.toSorted(), madeIds, "what the undo took back");
    for (const id of madeIds) {
      expect(await isDeleted(library, id), `the undo left ${id} in the library`);
    }

    ctx.log("a deletion the agent asks for waits for the person, who allows it");
    const { item: kept } = await library.items.createNote({ markdown: "Keep me.", title: "Keep" });
    const { item: gone } = await library.items.createNote({ markdown: "Bin me.", title: "Bin" });
    const allowed = await library.agent.send({ text: deleteDirective(gone.id) });
    await untilStatus(library, allowed.threadId, "awaiting_approval");
    expect(!(await isDeleted(library, gone.id)), "the deletion ran before the person answered");
    await library.agent.respond({
      eventId: await askedCall(library, allowed.threadId),
      result: "allow",
      threadId: allowed.threadId,
    });
    await untilStatus(library, allowed.threadId, "idle");
    expect(await isDeleted(library, gone.id), "the allowed deletion did not run");

    ctx.log("the next one the person denies, and the item stays");
    const denied = await library.agent.send({
      text: deleteDirective(kept.id),
      threadId: allowed.threadId,
    });
    await untilStatus(library, denied.threadId, "awaiting_approval");
    await library.agent.respond({
      eventId: await askedCall(library, denied.threadId),
      result: "deny",
      threadId: denied.threadId,
    });
    await untilStatus(library, denied.threadId, "idle");
    expect(!(await isDeleted(library, kept.id)), "the denied deletion ran");
    const answers = await eventsOf(library, denied.threadId, "approval.answered");
    expectEq(
      answers.map(({ event }) => event.result),
      ["allow", "deny"],
      "the person's answers, as the thread keeps them",
    );

    ctx.log("a turn that keeps working stops when the person cancels it");
    const stalled = await library.agent.send({ text: "stall" });
    expectEq(stalled.status, "running", "the stalled turn's status");
    await library.agent.cancel({ threadId: stalled.threadId });
    await untilStatus(library, stalled.threadId, "idle");
    expectEq(
      await endingsOf(library, stalled.threadId),
      ["cancelled"],
      "how the stopped turn ended",
    );

    ctx.log(
      "a turn whose next call the allowance cannot reserve ends there, and the thread goes on",
    );
    const words = Array.from({ length: LONG_NOTE_WORDS }, (_, index) => `word${String(index)}`);
    const { item: long } = await library.items.createNote({
      markdown: words.join(" "),
      title: "Long",
    });
    const reads = Array.from(
      { length: READS },
      () => `call read_item ${JSON.stringify({ id: long.id })}`,
    );
    const spending = await library.agent.send({
      text: ["Read it again and again.", ...reads].join("\n"),
    });
    await untilStatus(library, spending.threadId, "idle");
    expectEq(await endingsOf(library, spending.threadId), ["budget"], "how the costly turn ended");
    const results = await eventsOf(library, spending.threadId, "agent.tool_result");
    expect(
      results.length > 1 && results.length < READS,
      `the reads the turn could pay for: ${String(results.length)}`,
    );
    const next = await library.agent.send({ text: "Go on.", threadId: spending.threadId });
    expectEq(next, { status: "running", threadId: spending.threadId }, "the next send");
    await untilStatus(library, spending.threadId, "idle");
    expectEq(
      await endingsOf(library, spending.threadId),
      ["budget", "done"],
      "the conversation, going on",
    );
    ctx.log(
      "a conversation the API compacts goes on from the compaction, and its next turn answers",
    );
    const compacted = await library.agent.send({
      text: [
        "Note this, then look again.",
        'call create_note {"markdown":"Kept past a summary."}',
        "compact",
        'call search_library {"query":"summary"}',
        'call search_library {"query":"kept"}',
      ].join("\n"),
    });
    await untilStatus(library, compacted.threadId, "idle");
    const after = await library.agent.send({ text: "And now?", threadId: compacted.threadId });
    expectEq(after, { status: "running", threadId: compacted.threadId }, "the send after it");
    await untilStatus(library, compacted.threadId, "idle");
    expectEq(
      await endingsOf(library, compacted.threadId),
      ["done", "done"],
      "the compacted conversation, going on",
    );
    const notes = await eventsOf(library, compacted.threadId, "agent.progress");
    expectEq(notes.length, 3, "the progress notes, one before each tool call");

    const status = await library.agent.status();
    expectEq(status.turnsLeft, ALLOWANCE.dayTurns - 8, "the turns left of the day");

    const stats = await fakeStats(worker);
    expectEq(stats.drops, 0, "the replayed thinking blocks Claude dropped");
    expect(stats.requests > 0, "no request reached the scripted API");
  },
};
