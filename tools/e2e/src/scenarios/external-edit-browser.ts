import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { agentBrowserSession, closeQuietly, probeHeadlessOrSkip } from "../harness/agent-browser";
import { expect } from "../harness/assert";
import type { Scenario } from "../harness/scenario";

const agentBrowser = agentBrowserSession("external-edit");
const PROMPT = "rewrite the note";
const BASE_NOTE = "# Agent note\n\nthe line that was already here\n";
const TURN_DEADLINE_MS = 30_000;
const EDITOR = '[data-slate-editor="true"]';

export const externalEditBrowser: Scenario = {
  description: "a clean buffer adopts an agent write; a dirty buffer merges instead of clobbering",
  name: "external-edit-browser",
  async run(ctx) {
    const app = await ctx.boot({
      extraEnv: { INTELIGIR_AGENT: "scripted" },
      name: "solo",
    });

    ctx.log("create the thread whose scripted turn owns a note path");
    const { thread } = await app.api.threads.create({ title: PROMPT });
    // the scripted driver writes exactly here.
    const notePath = `Agent/${thread.id}.md`;
    await app.api.vault.write({ content: BASE_NOTE, ifAbsent: true, path: notePath });

    try {
      await probeHeadlessOrSkip(agentBrowser, ctx.log);

      ctx.log(`opening ${app.baseUrl}/`);
      // deep link rather than listing order: the seeded Welcome note outranks "first doc".
      await agentBrowser(["open", `${app.baseUrl}/?note=${encodeURIComponent(notePath)}`], 60_000);
      await agentBrowser(["wait", EDITOR], 90_000);
      const opened = await agentBrowser(["get", "text", EDITOR]);
      expect(
        opened.includes("the line that was already here"),
        `the browser did not open ${notePath} — got: ${opened}`,
      );

      ctx.log("clean buffer: the agent rewrites the note, the editor adopts");
      await app.api.threads.send({ text: PROMPT, threadId: thread.id });

      const adoptDeadline = Date.now() + TURN_DEADLINE_MS;
      for (;;) {
        const buffer = await agentBrowser(["get", "text", EDITOR]);
        if (buffer.includes(PROMPT)) {
          expect(
            !buffer.includes("the line that was already here"),
            `the buffer kept the replaced base:\n${buffer}`,
          );
          break;
        }
        expect(Date.now() < adoptDeadline, `the buffer never adopted the write — got: ${buffer}`);
        await delay(250);
      }
      const rewritten = await readFile(path.join(app.vaultDir, notePath), "utf-8");
      expect(rewritten.includes(PROMPT), `the agent's write never reached disk:\n${rewritten}`);

      ctx.log("dirty buffer: a mid-keystroke external write merges on the save");
      await agentBrowser(["click", EDITOR]);
      await agentBrowser(["press", "End"]);
      await agentBrowser(["type", EDITOR, " user-typed-tail"]);
      // inside the autosave debounce: append a line the buffer does not hold.
      const external = `${rewritten}\nexternal-appended-line\n`;
      await writeFile(path.join(app.vaultDir, notePath), external, "utf-8");

      const mergeDeadline = Date.now() + TURN_DEADLINE_MS;
      for (;;) {
        const onDisk = await readFile(path.join(app.vaultDir, notePath), "utf-8");
        if (onDisk.includes("user-typed-tail") && onDisk.includes("external-appended-line")) {
          break;
        }
        expect(Date.now() < mergeDeadline, `disk never held both sides of the merge:\n${onDisk}`);
        await delay(250);
      }
    } finally {
      await closeQuietly(agentBrowser);
    }
  },
};
