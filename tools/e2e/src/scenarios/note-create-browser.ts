import path from "node:path";
import { z } from "zod";
import { modChord, parseEval } from "../harness/agent-browser";
import { expect } from "../harness/assert";
import { readOrNull } from "../harness/exec";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { EDITOR } from "../harness/selectors";

const NOTE_NAME = "Session note";
const NOTE_PATH = `${NOTE_NAME}.md`;
const CREATE_DEADLINE_MS = 30_000;
// the open item's title: typing it renames the note
const TITLE = "h1[contenteditable]";
const MENU_OPEN = `document.querySelector('[role="menu"] [role="menuitem"]') === null ? "closed" : "open"`;
// a note the page makes says when it came in, as every item the app makes does, and holds no
// text yet; the rename may keep the provisional name beside it as an alias
const SAVED_ONLY =
  /^---\nsaved: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\n(?:aliases:\n(?: {2}- .+\n)+)?---\n$/u;

export const noteCreateBrowser: Scenario = {
  description:
    "a note created through the session — the library's Add › New note, its title typed, Enter — lands on disk as the file a user would go looking for, holding only the date it was saved",
  name: "note-create-browser",
  async run(ctx) {
    const app = await ctx.boot({ name: "solo" });
    const agentBrowser = await ctx.browser("note-create");

    ctx.log(`opening ${app.baseUrl}/ on the library`);
    await agentBrowser.openWorkspace(app);

    ctx.log("Add › New note opens an untitled note, which its typed title names");
    // a click that lands while the library is still settling opens nothing, so it is made again
    await pollUntil(
      async () => {
        if (parseEval(await agentBrowser(["eval", MENU_OPEN]), z.string()) === "closed") {
          await agentBrowser(["find", "role", "button", "click", "--name", "Add", "--exact"]);
        }
        return parseEval(await agentBrowser(["eval", MENU_OPEN]), z.string());
      },
      (menu) => menu === "open",
      {
        deadlineMs: CREATE_DEADLINE_MS,
        describe: () => "the Add menu never opened",
        // long enough for a menu the click did open to draw before it is clicked again
        intervalMs: 1000,
      },
    );
    await agentBrowser(["find", "role", "menuitem", "click", "--name", "New note", "--exact"]);
    await agentBrowser(["wait", EDITOR], 30_000);
    await agentBrowser(["wait", TITLE], 30_000);
    // the title shows the note's name, so the name typed replaces it whole
    await agentBrowser(["click", TITLE]);
    await agentBrowser(["press", modChord("a")]);
    await agentBrowser(["keyboard", "type", NOTE_NAME]);
    await agentBrowser(["press", "Enter"]);

    ctx.log(`waiting for ${NOTE_PATH} to land on disk, holding only its saved date`);
    await pollUntil(
      async () => await readOrNull(path.join(app.vaultDir, NOTE_PATH)),
      (read) => read !== null && SAVED_ONLY.test(read),
      {
        deadlineMs: CREATE_DEADLINE_MS,
        describe: (read) =>
          read === null
            ? `${NOTE_PATH} never reached disk`
            : `a new note holds only its saved date, but ${NOTE_PATH} holds:\n${read}`,
      },
    );
    expect(
      (await readOrNull(path.join(app.vaultDir, "Untitled.md"))) === null,
      "the untitled note was copied rather than renamed",
    );
  },
};
