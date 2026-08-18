// The whole feature, in one path nobody can shortcut: a real browser opens a
// note, selects a paragraph with real keystrokes, types a follow-up into THE
// DOCK — not the selection tooltip, which is the delegation flow and already
// had a doc referent — and presses Enter.
//
// Two assertions, and they are different claims. The stored user row proves
// the client produced a context and the server recorded it BESIDE the text
// (the bubble stays exactly what was typed). The assistant echo proves the
// composed block reached the provider's prompt input: the scripted driver
// echoes what `turnPromptInput` handed it, which is the only place an e2e can
// see what a real provider would have received.
//
// A green unit suite proves neither — the dock never handed the composer
// anything in it.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { TimelineConversationRow, TimelineRow } from "@repo/server-contract/thread-timeline";
import { agentBrowserSession, probeHeadlessOrSkip } from "../harness/agent-browser";
import { expect, expectEq } from "../harness/assert";
import type { Scenario } from "../harness/scenario";

const agentBrowser = agentBrowserSession("view-context");
const DOC_PATH = "Plans.md";
const PARAGRAPH = "First paragraph to delegate.";
const DOC = `# Plans

${PARAGRAPH}
`;
const MESSAGE = "make this shorter";
const TURN_DEADLINE_MS = 30_000;
/** The composer's textarea — the dock's own input, by its accessible name. */
const COMPOSER = 'textarea[aria-label="Message the agent"]';
/** The third rendered line of the seeded doc is the paragraph. */
const PARAGRAPH_LINE = ".cm-content .cm-line:nth-child(3)";

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export const viewContextBrowser: Scenario = {
  name: "view-context-browser",
  description:
    "select a paragraph, send from the dock, and the agent is told the path, the revision and the selection",
  async run(ctx) {
    const app = await ctx.boot({
      name: "solo",
      extraEnv: { INTELIGIR_AGENT: "scripted" },
      // Sorts before the seeded welcome note, so the virgin boot opens it.
      seedVault: async (vaultDir) => {
        await writeFile(join(vaultDir, DOC_PATH), DOC, "utf8");
      },
    });

    try {
      await probeHeadlessOrSkip(agentBrowser, ctx.log);

      ctx.log(`opening ${app.baseUrl}/`);
      await agentBrowser(["open", `${app.baseUrl}/`], 60_000);
      await agentBrowser(["wait", ".cm-content"], 90_000);
      await agentBrowser(["wait", PARAGRAPH_LINE], 90_000);

      ctx.log("selecting the paragraph with real keystrokes");
      await agentBrowser(["click", PARAGRAPH_LINE]);
      await agentBrowser(["press", "Home"]);
      await agentBrowser(["press", "Shift+End"]);
      const selected = await agentBrowser(["eval", "window.getSelection().toString()"]);
      expect(
        selected.includes(PARAGRAPH),
        `the browser selected something else — got: ${selected}`,
      );

      ctx.log("typing into the dock and sending");
      await agentBrowser(["fill", COMPOSER, MESSAGE]);
      await agentBrowser(["press", "Enter"]);

      // `idle` alone does not mean the turn RAN: the dock creates the thread on
      // submit, and a row exists (idle, empty) for a beat before the turn
      // starts. So the settle condition is idle AND the user's own message
      // already on the timeline — otherwise this reads the empty window and
      // fails on a timeline that was simply not written yet.
      ctx.log("waiting for the turn to settle");
      const deadline = Date.now() + TURN_DEADLINE_MS;
      let rows: readonly TimelineRow[] = [];
      for (;;) {
        const listed = await app.api.threads.list.$get();
        expect(listed.status === 200, `threads list answered ${listed.status}`);
        const chat = (await listed.json()).threads.find(
          (thread) => thread.originDocPath === null && thread.archivedAt === null,
        );
        if (chat !== undefined && chat.status === "idle") {
          const timeline = await app.api.threads.timeline.$get({ query: { threadId: chat.id } });
          expect(timeline.status === 200, `timeline answered ${timeline.status}`);
          const body = await timeline.json();
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
      // The bubble is what was typed, byte for byte — the context rides beside
      // it, never folded into it.
      expectEq(sent.text, MESSAGE, "the stored message text");
      const context = sent.viewContext;
      expect(context !== null, "the send carried no view context");
      expectEq(context.resource, DOC_PATH, "the doc the user was looking at");
      expectEq(context.selection?.text, PARAGRAPH, "the selected text");
      // The revision names the bytes on disk, which is what the flush before
      // the send is for.
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
      // What the provider was actually handed.
      expect(
        answered.text.includes(DOC_PATH),
        `the prompt did not name the doc — got: ${answered.text}`,
      );
      expect(
        answered.text.includes(PARAGRAPH),
        `the prompt did not carry the selection — got: ${answered.text}`,
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
