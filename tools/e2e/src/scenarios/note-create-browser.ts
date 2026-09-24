import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect } from "../harness/assert";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";

const NOTE_NAME = "Session note";
const NOTE_PATH = `${NOTE_NAME}.md`;
const CREATE_DEADLINE_MS = 30_000;
const NAME_INPUT = '[role="tree"] input[aria-label="Name"]';

export const noteCreateBrowser: Scenario = {
  description: "the sidebar's New note creates the file on disk through the session",
  name: "note-create-browser",
  async run(ctx) {
    const app = await ctx.boot({ name: "solo" });
    const agentBrowser = await ctx.browser("note-create");

    ctx.log(`opening ${app.baseUrl}/`);
    await agentBrowser.openWorkspace(app);

    ctx.log("New note from the sidebar, named inline");
    await agentBrowser(["find", "role", "button", "click", "--name", "New note", "--exact"]);
    await agentBrowser(["wait", NAME_INPUT], 30_000);
    await agentBrowser(["fill", NAME_INPUT, NOTE_NAME]);
    await agentBrowser(["press", "Enter"]);

    ctx.log(`waiting for ${NOTE_PATH} to land on disk`);
    const bytes = await pollUntil(
      async () => await readFile(path.join(app.vaultDir, NOTE_PATH), "utf-8").catch(() => null),
      (read) => read !== null,
      { deadlineMs: CREATE_DEADLINE_MS, describe: () => `${NOTE_PATH} never reached disk` },
    );
    expect(bytes === "", `a new note is created empty, but ${NOTE_PATH} holds:\n${bytes}`);
  },
};
