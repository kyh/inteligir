import { randomUUID } from "node:crypto";

import { agentUsage } from "@repo/db/agent-schema";
import { db } from "@repo/db/drizzle-client";
import { dbSuite } from "@repo/db/test-database";
import { and, eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";

import {
  createFakeAgentPlatform,
  fakeAgentRuntime,
} from "../test-support/fake-agent-platform.test-utils";
import type { FakeAgentPlatform } from "../test-support/fake-agent-platform.test-utils";
import { personalLibrary } from "../test-support/library.fixture";
import { caughtUp, readStream, shownOf } from "../test-support/thread-reads.test-utils";
import type { LibraryWriter } from "../library/library-store";
import { filingRulesFor } from "./agent-preference";
import { sendToAgent, setAgentEnabled } from "./agent-sessions";
import { threadOf } from "./agent-threads";
import type { AgentRuntime } from "./runtime";

const CREATE_NOTE = 'call create_note {"markdown":"Water the garden.","title":"Garden"}';

let platform: FakeAgentPlatform;
let runtime: AgentRuntime;

beforeEach(() => {
  platform = createFakeAgentPlatform();
  ({ runtime } = fakeAgentRuntime(platform));
});

type Library = Awaited<ReturnType<typeof personalLibrary>>["library"];

const shownIn = async (library: Library, threadId: string) =>
  shownOf(await readStream(await library.agent.events({ threadId }), caughtUp));

const personOf = (accountId: string) =>
  ({ accountId, actor: { kind: "person" } }) satisfies LibraryWriter;

const refusalOf = async (sent: Promise<unknown>) => {
  try {
    await sent;
  } catch (error) {
    return error;
  }

  throw new Error("the send was let in");
};

const turnsBooked = async (accountId: string) =>
  await db
    .select({ threadId: agentUsage.threadId })
    .from(agentUsage)
    .where(and(eq(agentUsage.accountId, accountId), eq(agentUsage.kind, "turn")));

dbSuite("the person's standing with the built-in agent", () => {
  it("keeps no filing rules until the person writes some, as written, and answers a resend as it did", async () => {
    const { accountId, library } = await personalLibrary();
    await expect(library.agent.rules()).resolves.toStrictEqual({ rules: null });
    await expect(filingRulesFor(accountId)).resolves.toBeNull();

    const first = { opId: randomUUID(), rules: "File birds under Birds.\n" };
    await expect(library.agent.setRules(first)).resolves.toStrictEqual({ rules: first.rules });
    await expect(library.agent.rules()).resolves.toStrictEqual({ rules: first.rules });
    await expect(filingRulesFor(accountId)).resolves.toBe(first.rules);

    await library.agent.setRules({ opId: randomUUID(), rules: "  \n" });
    await expect(library.agent.rules()).resolves.toStrictEqual({ rules: "  \n" });
    await expect(filingRulesFor(accountId)).resolves.toBeNull();
    await expect(library.agent.setRules(first)).resolves.toStrictEqual({ rules: first.rules });
    await expect(library.agent.rules()).resolves.toStrictEqual({ rules: "  \n" });
    await expect(library.agent.status()).resolves.toMatchObject({ enabled: true });
  });

  it("hands a turn the rules as they stand when it starts, and none while the page is blank", async () => {
    const { accountId, library } = await personalLibrary();
    const { threadId } = await sendToAgent(runtime, accountId, { text: "rules" });
    await platform.turnsSettled();
    await library.agent.setRules({ rules: "File birds under Birds." });
    await sendToAgent(runtime, accountId, { text: "rules", threadId });
    await platform.turnsSettled();

    const shown = await shownIn(library, threadId);
    const replies = shown.flatMap((event) => (event.type === "agent.message" ? [event.text] : []));
    expect(replies).toStrictEqual(["Filing rules: none", "Filing rules: File birds under Birds."]);
  });

  it("switches through its row, keeping the rules", async () => {
    const { library } = await personalLibrary();
    await library.agent.setRules({ rules: "Tag recipes cooking." });
    await expect(library.agent.setEnabled({ enabled: false })).resolves.toStrictEqual({
      enabled: false,
    });
    await expect(library.agent.status()).resolves.toMatchObject({ enabled: false });
    await expect(library.agent.setEnabled({ enabled: true })).resolves.toStrictEqual({
      enabled: true,
    });
    await expect(library.agent.status()).resolves.toMatchObject({ enabled: true });
    await expect(library.agent.rules()).resolves.toStrictEqual({ rules: "Tag recipes cooking." });
  });

  it("stops the turn running when it goes off, refuses sends while off, its threads readable, and lets them in once on", async () => {
    const { accountId, library } = await personalLibrary();
    const { threadId } = await sendToAgent(runtime, accountId, { text: "long 6000" });
    await expect(
      setAgentEnabled(runtime, personOf(accountId), { enabled: false, opId: randomUUID() }),
    ).resolves.toStrictEqual({ enabled: false });
    await platform.turnsSettled();

    const shown = await shownIn(library, threadId);
    expect(shown.at(-1)).toMatchObject({ reason: "cancelled", turn: 1, type: "turn.ended" });
    await expect(threadOf(accountId, threadId)).resolves.toMatchObject({ status: "idle" });
    expect(await refusalOf(sendToAgent(runtime, accountId, { text: "Hello" }))).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      data: undefined,
    });
    expect(
      await refusalOf(sendToAgent(runtime, accountId, { text: "Hello", threadId })),
    ).toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    await expect(library.agent.list({})).resolves.toMatchObject({ threads: [{ id: threadId }] });

    await setAgentEnabled(runtime, personOf(accountId), { enabled: true });
    await sendToAgent(runtime, accountId, { text: CREATE_NOTE, threadId });
    await platform.turnsSettled();
    await expect(library.items.list({})).resolves.toMatchObject({ items: [{ title: "Garden" }] });
  });

  it("stops a turn begun while off before its first model call, booking none of the day's turns", async () => {
    const { accountId, library } = await personalLibrary();
    const { threadId } = await sendToAgent(runtime, accountId, { text: "Hello" });
    await platform.turnsSettled();
    await setAgentEnabled(runtime, personOf(accountId), { enabled: false });
    const row = await threadOf(accountId, threadId);
    const sessionId = row?.eveSessionId ?? "";
    await runtime.platform.send({ accountId, eveSessionNumber: 1, threadId }, sessionId, {
      text: CREATE_NOTE,
    });
    await platform.turnsSettled();

    const shown = await shownIn(library, threadId);
    expect(shown.slice(-2)).toStrictEqual([
      { text: CREATE_NOTE, type: "user.message" },
      { reason: "cancelled", turn: 2, type: "turn.ended" },
    ]);
    await expect(library.items.list({})).resolves.toMatchObject({ items: [] });
    await expect(turnsBooked(accountId)).resolves.toHaveLength(1);
  });
});
