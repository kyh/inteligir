// A note created THROUGH THE SESSION lands on disk. Every other scenario seeds
// its notes by calling `vault.write` directly — the one path a broken session
// create never takes — so this one drives the renderer's own port: the
// sidebar's "New note", the inline name, Enter. What is asserted is the file
// the server wrote, which is what a user would go looking for.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { agentBrowserSession, probeHeadlessOrSkip } from "../harness/agent-browser";
import { expect } from "../harness/assert";
import type { Scenario } from "../harness/scenario";

const agentBrowser = agentBrowserSession("note-create");
const NOTE_NAME = "Session note";
const NOTE_PATH = `${NOTE_NAME}.md`;
const CREATE_DEADLINE_MS = 30_000;
const SIDEBAR = '[data-slot="sidebar-wrapper"]';
const EDITOR = '[data-slate-editor="true"]';
/** The file tree's inline name box, which the sidebar's "New note" opens. */
const NAME_INPUT = '[role="tree"] input[aria-label="Name"]';

export const noteCreateBrowser: Scenario = {
  name: "note-create-browser",
  description: "the sidebar's New note creates the file on disk through the session",
  async run(ctx) {
    const app = await ctx.boot({ name: "solo" });
    try {
      await probeHeadlessOrSkip(agentBrowser, ctx.log);

      ctx.log(`opening ${app.baseUrl}/`);
      await agentBrowser(["open", `${app.baseUrl}/`], 60_000);
      await agentBrowser(["wait", SIDEBAR], 90_000);
      await agentBrowser(["wait", EDITOR], 90_000);

      ctx.log("New note from the sidebar, named inline");
      await agentBrowser(["find", "role", "button", "click", "--name", "New note", "--exact"]);
      await agentBrowser(["wait", NAME_INPUT], 30_000);
      await agentBrowser(["fill", NAME_INPUT, NOTE_NAME]);
      await agentBrowser(["press", "Enter"]);

      ctx.log(`waiting for ${NOTE_PATH} to land on disk`);
      const deadline = Date.now() + CREATE_DEADLINE_MS;
      for (;;) {
        const bytes = await readFile(join(app.vaultDir, NOTE_PATH), "utf8").catch(() => null);
        if (bytes !== null) {
          expect(bytes === "", `a new note is created empty, but ${NOTE_PATH} holds:\n${bytes}`);
          break;
        }
        expect(Date.now() < deadline, `${NOTE_PATH} never reached disk`);
        await delay(250);
      }
    } finally {
      await agentBrowser(["close"], 30_000).catch(() => undefined);
    }
  },
};
