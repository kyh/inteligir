import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TimelineConversationRow, TimelineRow } from "@repo/api/local/thread-timeline";
import { contentHashHex } from "@repo/api/local/vault/vault-schema";
import { modChord } from "../harness/agent-browser";
import { expect, expectEq } from "../harness/assert";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { COMPOSER, EDITOR } from "../harness/selectors";

const DOC_PATH = "Plans.md";
const PARAGRAPH = "First paragraph to send.";
const DOC = `# Plans

${PARAGRAPH}
`;
const MESSAGE = "make this shorter";
const TURN_DEADLINE_MS = 30_000;

const NO_ROWS: readonly TimelineRow[] = [];

const hasUserRow = (rows: readonly TimelineRow[]): boolean =>
  rows.some((row) => row.kind === "conversation" && row.role === "user");

export const viewContextBrowser: Scenario = {
  description: "send from the composer, and the agent is told the path and the revision",
  name: "view-context-browser",
  async run(ctx) {
    const app = await ctx.boot({
      extraEnv: { INTELIGIR_AGENT: "scripted" },
      name: "solo",
      // sorts before the seeded welcome note, so the virgin boot opens it.
      seedVault: async (vaultDir) => {
        await writeFile(path.join(vaultDir, DOC_PATH), DOC, "utf-8");
      },
    });
    const agentBrowser = await ctx.browser("view-context");

    ctx.log(`opening ${app.baseUrl}/`);
    await agentBrowser.openWorkspace(app);
    const opened = await agentBrowser(["get", "text", EDITOR]);
    expect(opened.includes(PARAGRAPH), `the browser did not open ${DOC_PATH} — got: ${opened}`);

    ctx.log("opening the action composer (⌘K) and sending");
    await agentBrowser(["press", modChord("k")]);
    await agentBrowser(["wait", COMPOSER], 30_000);
    await agentBrowser(["fill", COMPOSER, MESSAGE]);
    await agentBrowser(["press", modChord("Enter")]);

    // idle alone does not mean the turn ran: the thread exists idle and empty for a beat before
    // the turn starts, so also require the user's own message on the timeline.
    ctx.log("waiting for the turn to settle");
    const { rows } = await pollUntil(
      async () => {
        const listed = await app.api.threads.list({});
        // the composer attaches the open note by default.
        const chat = listed.threads.find(
          (thread) => thread.originDocPath === DOC_PATH && thread.archivedAt === null,
        );
        if (chat === undefined || chat.status !== "idle") {
          return { chat, rows: NO_ROWS };
        }
        const body = await app.api.threads.timeline({ threadId: chat.id });
        expect(body.kind === "full", `expected the full timeline, got "${body.kind}"`);
        return { chat, rows: body.timeline.rows };
      },
      (settled) => {
        expect(settled.chat?.status !== "error", "the turn settled in error");
        return hasUserRow(settled.rows);
      },
      {
        deadlineMs: TURN_DEADLINE_MS,
        describe: () => `no settled chat turn after ${TURN_DEADLINE_MS}ms`,
      },
    );

    const sent = rows.find(
      (row): row is TimelineConversationRow => row.kind === "conversation" && row.role === "user",
    );
    expect(sent !== undefined, "the user's message is not on the timeline");
    expectEq(sent.text, MESSAGE, "the stored message text");
    const context = sent.viewContext;
    expect(context !== null, "the send carried no view context");
    expectEq(context.resource, DOC_PATH, "the doc the user was looking at");
    // the flush before the send is what makes the revision name the bytes on disk.
    expectEq(
      context.revision,
      await contentHashHex(await readFile(path.join(app.vaultDir, DOC_PATH), "utf-8")),
      "the revision names the file as it is on disk",
    );

    const answered = rows.find(
      (row): row is TimelineConversationRow =>
        row.kind === "conversation" && row.role === "assistant",
    );
    expect(answered !== undefined, "the scripted agent did not answer");
    // the scripted driver echoes what turnPromptInput handed it: the only view an e2e has of the
    // provider's prompt.
    expect(
      answered.text.includes(DOC_PATH),
      `the prompt did not name the doc — got: ${answered.text}`,
    );
    expect(
      answered.text.includes(MESSAGE),
      `the prompt did not carry the user's own text — got: ${answered.text}`,
    );
  },
};
