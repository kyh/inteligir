// External writes against the OPEN note, both sides of the dirty gate.
//
// CLEAN BUFFER: the scripted agent rewrites the note through the vault
// service — watcher, ws ping, session reload, buffer adoption — and the
// rendered editor updates on its own. Every hop is production code.
//
// DIRTY BUFFER: the user is mid-keystroke when the file changes under them.
// The reload refuses (unsaved edits win the buffer), and the autosave's
// guarded write meets the CAS 409 instead — the port three-way merges and
// retries, so DISK ends up holding both changes. No silent clobber in either
// direction is the invariant; the attribution tint died with the CM editor.

import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { join } from "node:path";
import { agentBrowserSession, probeHeadlessOrSkip } from "../harness/agent-browser";
import { expect } from "../harness/assert";
import type { Scenario } from "../harness/scenario";

const agentBrowser = agentBrowserSession("external-edit");
const PROMPT = "rewrite the note";
const BASE_NOTE = "# Agent note\n\nthe line that was already here\n";
const TURN_DEADLINE_MS = 30_000;
const EDITOR = '[data-slate-editor="true"]';

export const externalEditBrowser: Scenario = {
  name: "external-edit-browser",
  description: "a clean buffer adopts an agent write; a dirty buffer merges instead of clobbering",
  async run(ctx) {
    const app = await ctx.boot({
      name: "solo",
      extraEnv: { INTELIGIR_AGENT: "scripted" },
    });

    ctx.log("create the thread whose scripted turn owns a note path");
    const { thread } = await app.api.threads.create({ title: PROMPT });
    // The scripted driver writes exactly here; folders sort before root
    // files, so the virgin boot opens this note without a deep link.
    const notePath = `Agent/${thread.id}.md`;
    await app.api.vault.write({ path: notePath, content: BASE_NOTE, ifAbsent: true });

    try {
      await probeHeadlessOrSkip(agentBrowser, ctx.log);

      ctx.log(`opening ${app.baseUrl}/`);
      // Name the note in the deep link rather than relying on listing order:
      // the seeded vault's front door (Welcome) outranks "first doc", and this
      // scenario is about external edits, not the boot pick.
      await agentBrowser(["open", `${app.baseUrl}/?note=${encodeURIComponent(notePath)}`], 60_000);
      await agentBrowser(["wait", EDITOR], 90_000);
      const opened = await agentBrowser(["get", "text", EDITOR]);
      expect(
        opened.includes("the line that was already here"),
        `the browser did not open ${notePath} — got: ${opened}`,
      );

      ctx.log("clean buffer: the agent rewrites the note, the editor adopts");
      await app.api.threads.send({ threadId: thread.id, text: PROMPT });

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
      const rewritten = await readFile(join(app.vaultDir, notePath), "utf8");
      expect(rewritten.includes(PROMPT), `the agent's write never reached disk:\n${rewritten}`);

      ctx.log("dirty buffer: a mid-keystroke external write merges on the save");
      await agentBrowser(["click", EDITOR]);
      await agentBrowser(["press", "End"]);
      await agentBrowser(["type", EDITOR, " user-typed-tail"]);
      // Inside the autosave debounce: append a line the buffer does not hold.
      const external = `${rewritten}\nexternal-appended-line\n`;
      await writeFile(join(app.vaultDir, notePath), external, "utf8");

      const mergeDeadline = Date.now() + TURN_DEADLINE_MS;
      for (;;) {
        const onDisk = await readFile(join(app.vaultDir, notePath), "utf8");
        if (onDisk.includes("user-typed-tail") && onDisk.includes("external-appended-line")) {
          break;
        }
        expect(Date.now() < mergeDeadline, `disk never held both sides of the merge:\n${onDisk}`);
        await delay(250);
      }
    } finally {
      await agentBrowser(["close"], 30_000).catch(() => undefined);
    }
  },
};
