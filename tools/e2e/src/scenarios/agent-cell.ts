import type { V1Client } from "@repo/contract/cloud/v1";
import { z } from "zod";
import { expect, expectEq } from "../harness/assert";
import { OWNER, signUp } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { v1Client } from "../harness/v1-wire";

const DEADLINE_MS = 60_000;

// a day that holds every turn the scenario runs, each turn capped at 50 cents
const ALLOWANCE = { dayCents: 1000, dayTurns: 20, turnCents: 50 };

type Library = V1Client["library"];
type ThreadStatus = Awaited<ReturnType<Library["agent"]["list"]>>["threads"][number]["status"];

// the stored events this scenario reads: their type, the call an approval waits on, and a
// message's words
const storedEventSchema = z.looseObject({
  content: z.array(z.looseObject({ text: z.string().optional() })).optional(),
  result: z.string().optional(),
  stop_reason: z
    .looseObject({ event_ids: z.array(z.string()).optional(), type: z.string() })
    .optional(),
  type: z.string(),
});

// the thread's stored events, of one type when it is named
const eventsOf = async (library: Library, threadId: string, type?: string) => {
  const { events } = await library.agent.events({ threadId });
  const stored = events.map((row) => storedEventSchema.parse(row.event));
  return type === undefined ? stored : stored.filter((event) => event.type === type);
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

// the agent's change sets, newest first
const agentSets = async (library: Library) => {
  const { changeSets } = await library.history.list({});
  return changeSets.filter((set) => set.actor === "agent");
};

// the call a paused turn asks the person about, by the event that asked
const askedCall = async (library: Library, threadId: string): Promise<string> => {
  const events = await eventsOf(library, threadId);
  const paused = events.findLast(
    (event) =>
      event.type === "session.status_idle" && event.stop_reason?.type === "requires_action",
  );
  const [eventId] = paused?.stop_reason?.event_ids ?? [];
  expect(eventId !== undefined, `the paused turn asked about nothing: ${JSON.stringify(events)}`);
  return eventId;
};

const deleteDirective = (id: string): string =>
  `call delete_items ${JSON.stringify({ ids: [id] })}`;

const isDeleted = async (library: Library, id: string): Promise<boolean> => {
  const { fields } = await library.items.read({ id });
  return fields.deletedAt !== null;
};

export const agentCell: Scenario = {
  description:
    "the built-in agent's turns in a Miniflare Worker's library cell, against the fake Managed Agents API through the SDK: a turn's two notes land in one change set an undo takes back whole; a deletion the agent asks for waits for the person, and runs when allowed and not when denied; cancelling a turn that keeps working interrupts it; a turn past its 50-cent cap stops the thread, and its next send starts a fresh conversation that carries what was said",
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

    ctx.log("the person turns the agent on, which grants it the library through the connector");
    expectEq(await library.agent.setEnabled({ enabled: true }), { enabled: true }, "the switch");

    ctx.log("one turn makes two notes, in one change set an undo takes back whole");
    const first = await library.agent.send({
      text: 'Make two notes.\ncall create_note {"markdown":"Paris"}\ncall create_note {"markdown":"Lyon"}',
    });
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
    const confirmations = await eventsOf(library, denied.threadId, "user.tool_confirmation");
    expectEq(
      confirmations.map((event) => event.result),
      ["allow", "deny"],
      "the person's answers, as the thread keeps them",
    );

    ctx.log("a turn that keeps working stops when the person cancels it");
    const stalled = await library.agent.send({ text: "stall" });
    expectEq(stalled.status, "running", "the stalled turn's status");
    await library.agent.cancel({ threadId: stalled.threadId });
    await untilStatus(library, stalled.threadId, "idle");
    const stalledEvents = await eventsOf(library, stalled.threadId);
    const stalledTypes = stalledEvents.map((event) => event.type);
    expect(
      stalledTypes.includes("user.interrupt") && stalledTypes.at(-1) === "session.status_idle",
      `the cancelled turn's events: ${JSON.stringify(stalledTypes)}`,
    );

    ctx.log("a turn past its cap stops the thread, and the next send starts afresh");
    const spending = "spend 30\nspend 30\nspend 30";
    const capped = await library.agent.send({ text: spending });
    await untilStatus(library, capped.threadId, "stopped");
    const cappedEvents = await eventsOf(library, capped.threadId);
    expectEq(cappedEvents.at(-1)?.stop_reason?.type, "budget_reached", "how the capped turn ended");
    await library.agent.send({ text: "Go on.", threadId: capped.threadId });
    await untilStatus(library, capped.threadId, "idle");
    const messages = await eventsOf(library, capped.threadId, "user.message");
    expectEq(
      messages.at(-1)?.content?.map((block) => block.text),
      [
        `\`\`\`earlier-conversation\n${JSON.stringify({ role: "person", text: spending })}\n\`\`\``,
        "Go on.",
      ],
      "the fresh conversation's first message",
    );
    const status = await library.agent.status();
    expectEq(status.turnsLeft, ALLOWANCE.dayTurns - 6, "the turns left of the day");
  },
};
