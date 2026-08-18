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
import type { TimelineConversationRow } from "@repo/server-contract/thread-timeline";
import { expect, expectEq, skip } from "../harness/assert";
import { exec, ExecError } from "../harness/exec";
import type { Scenario } from "../harness/scenario";

const SESSION = `inteligir-e2e-view-context-${process.pid}`;
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

async function agentBrowser(args: readonly string[], timeoutMs = 60_000): Promise<string> {
  const result = await exec("agent-browser", ["--session", SESSION, ...args], { timeoutMs });
  return result.stdout.trim();
}

function describeExecError(error: unknown): string {
  if (error instanceof ExecError) {
    return [error.message, error.stdout.trim(), error.stderr.trim()]
      .filter((part) => part.length > 0)
      .join("\n");
  }
  return error instanceof Error ? error.message : String(error);
}

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
      ctx.log("probing the environment: can a headless browser launch at all?");
      try {
        await agentBrowser(["open", "about:blank"], 120_000);
      } catch (error) {
        skip(
          `agent-browser could not launch a headless browser in this environment; ` +
            `the exact error:\n${describeExecError(error)}`,
        );
      }

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

      ctx.log("waiting for the turn to settle");
      const deadline = Date.now() + TURN_DEADLINE_MS;
      let threadId: string | null = null;
      for (;;) {
        const listed = await app.api.threads.list.$get();
        expect(listed.status === 200, `threads list answered ${listed.status}`);
        const chat = (await listed.json()).threads.find(
          (thread) => thread.originDocPath === null && thread.archivedAt === null,
        );
        if (chat !== undefined && chat.status === "idle") {
          threadId = chat.id;
          break;
        }
        expect(chat?.status !== "error", "the turn settled in error");
        expect(Date.now() < deadline, `no settled chat thread after ${TURN_DEADLINE_MS}ms`);
        await delay(250);
      }

      const timeline = await app.api.threads.timeline.$get({ query: { threadId } });
      expect(timeline.status === 200, `timeline answered ${timeline.status}`);
      const body = await timeline.json();
      expect(body.kind === "full", `expected the full timeline, got "${body.kind}"`);
      const rows = body.kind === "full" ? body.timeline.rows : [];

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
