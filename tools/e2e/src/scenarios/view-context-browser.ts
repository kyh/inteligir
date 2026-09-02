import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { TimelineConversationRow, TimelineRow } from "@repo/api/local/thread-timeline";
import { agentBrowserSession, probeHeadlessOrSkip } from "../harness/agent-browser";
import { expect, expectEq } from "../harness/assert";
import type { Scenario } from "../harness/scenario";

const agentBrowser = agentBrowserSession("view-context");
const DOC_PATH = "Plans.md";
const PARAGRAPH = "First paragraph to send.";
const DOC = `# Plans

${PARAGRAPH}
`;
const MESSAGE = "make this shorter";
const TURN_DEADLINE_MS = 30_000;
const COMPOSER = 'textarea[aria-label="Ask the agent"]';
const EDITOR = '[data-slate-editor="true"]';

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export const viewContextBrowser: Scenario = {
  name: "view-context-browser",
  description: "send from the composer, and the agent is told the path and the revision",
  async run(ctx) {
    const app = await ctx.boot({
      name: "solo",
      extraEnv: { INTELIGIR_AGENT: "scripted" },
      // sorts before the seeded welcome note, so the virgin boot opens it.
      seedVault: async (vaultDir) => {
        await writeFile(join(vaultDir, DOC_PATH), DOC, "utf8");
      },
    });

    try {
      await probeHeadlessOrSkip(agentBrowser, ctx.log);

      ctx.log(`opening ${app.baseUrl}/`);
      await agentBrowser(["open", `${app.baseUrl}/`], 60_000);
      await agentBrowser(["wait", EDITOR], 90_000);
      const opened = await agentBrowser(["get", "text", EDITOR]);
      expect(opened.includes(PARAGRAPH), `the browser did not open ${DOC_PATH} — got: ${opened}`);

      ctx.log("opening the action composer (⌘K) and sending");
      await agentBrowser(["press", process.platform === "darwin" ? "Meta+k" : "Control+k"]);
      await agentBrowser(["wait", COMPOSER], 30_000);
      await agentBrowser(["fill", COMPOSER, MESSAGE]);
      await agentBrowser(["press", process.platform === "darwin" ? "Meta+Enter" : "Control+Enter"]);

      // idle alone does not mean the turn ran: the thread exists idle and empty for a beat before
      // the turn starts, so also require the user's own message on the timeline.
      ctx.log("waiting for the turn to settle");
      const deadline = Date.now() + TURN_DEADLINE_MS;
      let rows: readonly TimelineRow[] = [];
      for (;;) {
        const listed = await app.api.threads.list();
        // the composer attaches the open note by default.
        const chat = listed.threads.find(
          (thread) => thread.originDocPath === DOC_PATH && thread.archivedAt === null,
        );
        if (chat !== undefined && chat.status === "idle") {
          const body = await app.api.threads.timeline({ threadId: chat.id });
          expect(body.kind === "full", `expected the full timeline, got "${body.kind}"`);
          const settled = body.kind === "full" ? body.timeline.rows : [];
          if (settled.some((row) => row.kind === "conversation" && row.role === "user")) {
            rows = settled;
            break;
          }
        }
        expect(chat?.status !== "error", "the turn settled in error");
        expect(Date.now() < deadline, `no settled chat turn after ${TURN_DEADLINE_MS}ms`);
        await delay(250);
      }

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
        sha256Hex(await readFile(join(app.vaultDir, DOC_PATH), "utf8")),
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
    } finally {
      await agentBrowser(["close"], 30_000).catch(() => undefined);
    }
  },
};
