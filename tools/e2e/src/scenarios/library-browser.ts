// The library in the tab, read from the cell: the grid of every item, an item opened and
// left by the url's history, the rail's folder and tag scopes and the grid's kind chips, Quick
// Look, a tag added from Info, a card's Delete with its Undo, a folder made from the rail and an
// item moved into it, an open item following a rename made on another device, and a link pasted
// and a file dropped onto the grid each saved as an item.

import { ordBetween } from "@repo/notes/library/block-order";
import { z } from "zod";
import {
  clickButtonIn,
  clickStartingWith,
  openItemParam,
  parseEval,
} from "../harness/agent-browser";
import type { AgentBrowser } from "../harness/agent-browser";
import { expectEq } from "../harness/assert";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { openLibraryTab } from "../harness/library-tab";
import type { Library } from "../harness/library-tab";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import {
  BACK_TO_LIBRARY,
  EDITOR,
  LIBRARY_GRID,
  TOAST,
  clickCard,
  doubleClickCard,
  folderRow,
  libraryCard,
} from "../harness/selectors";
import { newItemId } from "../harness/v1-wire";

const DEADLINE_MS = 30_000;
const READING = "Reading";
const ARCHIVE = "Archive";
const TAG = "field";
const INFO_TAG = "e2e";
const RENAMED = "Field journal";
// a 1x1 transparent png
const PIXEL = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  ),
);

const CARD_IDS = `JSON.stringify([...document.querySelectorAll('[role="gridcell"][data-item-id]')].map((card) => card.dataset.itemId))`;
const TITLE_TEXT = `String(document.querySelector('[data-library-scope] h1')?.textContent ?? "")`;
const DIALOG_TEXT = `String(document.querySelector('[role="dialog"]')?.textContent ?? "")`;
const TITLE_FIELD = 'input[aria-label="Title"]';
// a host no page answers (TEST-NET-1), so the pasted link's reading fails without leaving the
// machine
const PASTED = "http://192.0.2.10/pasted";
const DROPPED = "field-notes.txt";
// a paste and a drop as the browser hands them over, onto the page where no field takes them
const PASTE = `(() => {
  const data = new DataTransfer();
  data.setData("text/plain", ${JSON.stringify(PASTED)});
  document.body.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  return true;
})()`;
const DROP = `(() => {
  const grid = document.querySelector(${JSON.stringify(LIBRARY_GRID)});
  if (!grid) return "missing";
  const data = new DataTransfer();
  data.items.add(new File(["Notes from the field."], ${JSON.stringify(DROPPED)}, { type: "text/plain" }));
  grid.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: data }));
  grid.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }));
  return "dropped";
})()`;

// a right-click on a card, as a pointer makes it. Answers "opened" or "missing".
const contextMenuOn = (itemId: string): string => `(() => {
  const card = document.querySelector(${JSON.stringify(libraryCard(itemId))});
  if (!card) return "missing";
  const box = card.getBoundingClientRect();
  card.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: box.x + 8, clientY: box.y + 8 }));
  return "opened";
})()`;

const untilCards = async (
  browser: AgentBrowser,
  holds: (ids: readonly string[]) => boolean,
  what: string,
): Promise<readonly string[]> =>
  await pollUntil(
    async () => parseEval(await browser(["eval", CARD_IDS]), z.array(z.string())),
    holds,
    { deadlineMs: DEADLINE_MS, describe: (ids) => `${what}; the grid shows ${ids.join(", ")}` },
  );

const untilTitle = async (browser: AgentBrowser, title: string): Promise<void> => {
  await pollUntil(
    async () => parseEval(await browser(["eval", TITLE_TEXT]), z.string()),
    (shown) => shown === title,
    {
      deadlineMs: DEADLINE_MS,
      describe: (shown) => `the library is titled "${shown}", not "${title}"`,
    },
  );
};

const untilItemParam = async (browser: AgentBrowser, wanted: string | null): Promise<void> => {
  await pollUntil(
    async () => await openItemParam(browser),
    (param) => param === wanted,
    {
      deadlineMs: DEADLINE_MS,
      describe: (param) => `the url names ${String(param)}, not ${String(wanted)}`,
    },
  );
};

const untilFields = async (
  library: Library,
  id: string,
  holds: (fields: Awaited<ReturnType<Library["items"]["read"]>>["fields"]) => boolean,
  what: string,
): Promise<void> => {
  await pollUntil(
    async () => {
      const { fields } = await library.items.read({ id });
      return fields;
    },
    holds,
    { deadlineMs: DEADLINE_MS, describe: (fields) => `${what}: ${JSON.stringify(fields)}` },
  );
};

const pickMenuItem = async (browser: AgentBrowser, itemId: string, name: string): Promise<void> => {
  expectEq(parseEval(await browser(["eval", contextMenuOn(itemId)]), z.string()), "opened", itemId);
  await browser(["find", "role", "menuitem", "click", "--name", name, "--exact"]);
};

export const libraryBrowser: Scenario = {
  description:
    "the tab's grid draws every item the cell holds; a double-click opens one and the url's Back and Forward leave and reopen it; a folder row, a tag row and a kind chip each narrow the grid; Space is Quick Look; a tag added from Info lands in the cell; a card's Delete goes to Deleted and its toast's Undo brings it back; a folder made from the rail takes an item moved into it; an open item follows a rename another device made; and a link pasted and a file dropped onto the grid are each saved as an item",
  name: "library-browser",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const ids = { field: "", pier: "", reading: "", welcome: "" };
    const tab = await openLibraryTab(ctx, "library", {
      seed: async (library, upload) => {
        ids.reading = newItemId();
        await library.folders.write({
          ops: [
            {
              id: ids.reading,
              name: READING,
              op: "create",
              parentId: null,
              sort: ordBetween(null, null),
            },
          ],
        });
        const welcome = await library.items.createNote({
          markdown: "# Welcome\n\nStart here.\n",
          title: "Welcome",
        });
        ids.welcome = welcome.item.id;
        const field = await library.items.createNote({
          folder: { id: ids.reading },
          markdown: "# Field notes\n\nNotes from the field.\n",
          tags: [TAG],
          title: "Field notes",
        });
        ids.field = field.item.id;
        const sha = await upload({ bytes: PIXEL, type: "image/png" });
        const pier = await library.items.createFile({
          folderId: null,
          id: newItemId(),
          name: "pier.png",
          savedAt: Date.now(),
          sha,
          tags: [],
        });
        ids.pier = pier.item.id;
      },
    });
    const { browser, library } = tab;

    ctx.log("the tab opens on the library, one card per item");
    await untilCards(
      browser,
      (shown) => [ids.welcome, ids.field, ids.pier].every((id) => shown.includes(id)),
      "the seeded items never all drew",
    );
    expectEq(await openItemParam(browser), null, "the url while the library shows");

    ctx.log("a double-click opens an item; Back is the library, Forward the item again");
    expectEq(
      parseEval(await browser(["eval", doubleClickCard(ids.welcome)]), z.string()),
      "opened",
      "the card's double-click",
    );
    await browser(["wait", EDITOR], DEADLINE_MS);
    await untilItemParam(browser, ids.welcome);
    await browser(["back"]);
    await browser(["wait", LIBRARY_GRID], DEADLINE_MS);
    await untilItemParam(browser, null);
    await browser(["forward"]);
    await browser(["wait", EDITOR], DEADLINE_MS);
    await untilItemParam(browser, ids.welcome);
    await browser(["click", BACK_TO_LIBRARY]);
    await browser(["wait", LIBRARY_GRID], DEADLINE_MS);

    ctx.log("a folder in the rail narrows the grid to what is in it");
    await browser(["click", folderRow(ids.reading)]);
    await untilTitle(browser, READING);
    await untilCards(
      browser,
      (shown) => shown.length === 1 && shown[0] === ids.field,
      "the folder scope never narrowed",
    );

    ctx.log("a tag in the rail narrows it to the tag's items");
    await clickStartingWith(browser, '[aria-label="Tags"]', TAG);
    await untilTitle(browser, `#${TAG}`);
    await untilCards(
      browser,
      (shown) => shown.length === 1 && shown[0] === ids.field,
      "the tag scope never narrowed",
    );

    ctx.log("a kind chip narrows All items to that kind, and lets go again");
    await clickStartingWith(browser, '[aria-label="Library"]', "All items");
    await untilTitle(browser, "All items");
    await clickStartingWith(browser, '[aria-label="Kind"]', "Images");
    await untilCards(
      browser,
      (shown) => shown.length === 1 && shown[0] === ids.pier,
      "the Images chip never narrowed",
    );
    await clickStartingWith(browser, '[aria-label="Kind"]', "Images");
    await untilCards(browser, (shown) => shown.length === 3, "the chip never let go");

    ctx.log("Space on the selected card is Quick Look, and Escape closes it");
    expectEq(
      parseEval(await browser(["eval", clickCard(ids.welcome)]), z.string()),
      "clicked",
      "select",
    );
    await browser(["press", "Space"]);
    await pollUntil(
      async () => parseEval(await browser(["eval", DIALOG_TEXT]), z.string()),
      (text) => text.includes("Start here."),
      { deadlineMs: DEADLINE_MS, describe: (text) => `Quick Look never showed Welcome: ${text}` },
    );
    await browser(["press", "Escape"]);
    await pollUntil(
      async () => parseEval(await browser(["eval", DIALOG_TEXT]), z.string()),
      (text) => text === "",
      { deadlineMs: DEADLINE_MS, describe: () => "Quick Look stayed open" },
    );

    ctx.log("a tag added from Info lands in the cell");
    await browser(["press", "]"]);
    await clickButtonIn(browser, '[data-side="right"]', "Tag…");
    await browser(["wait", 'input[aria-label="Tag to add"]'], DEADLINE_MS);
    await browser(["fill", 'input[aria-label="Tag to add"]', INFO_TAG]);
    await browser(["press", "Enter"]);
    await untilFields(
      library,
      ids.welcome,
      (fields) => fields.tags.includes(INFO_TAG),
      "Info's tag never reached the cell",
    );
    await browser(["press", "]"]);

    ctx.log("a card's Delete goes to Deleted, and its toast's Undo brings it back");
    await pickMenuItem(browser, ids.pier, "Delete");
    await untilFields(
      library,
      ids.pier,
      (fields) => fields.deletedAt !== null,
      "Delete never landed",
    );
    await clickButtonIn(browser, TOAST, "Undo");
    await untilFields(
      library,
      ids.pier,
      (fields) => fields.deletedAt === null,
      "Undo never landed",
    );
    await untilCards(browser, (shown) => shown.includes(ids.pier), "the restored card never drew");

    ctx.log("a folder made from the rail takes an item moved into it");
    await browser(["click", 'button[aria-label="New folder"]']);
    await browser(["wait", 'input[aria-label="Folder name"]'], DEADLINE_MS);
    await browser(["fill", 'input[aria-label="Folder name"]', ARCHIVE]);
    await browser(["press", "Enter"]);
    const archive = await pollUntil(
      async () => {
        const outline = await library.organize.outline();
        return outline.folders.find((folder) => folder.name === ARCHIVE) ?? null;
      },
      (folder) => folder !== null,
      { deadlineMs: DEADLINE_MS, describe: () => `the cell holds no folder "${ARCHIVE}"` },
    );
    await browser(["wait", folderRow(archive.id ?? "")], DEADLINE_MS);
    await pickMenuItem(browser, ids.welcome, "Move to…");
    await clickButtonIn(browser, '[role="dialog"]', ARCHIVE);
    await untilFields(
      library,
      ids.welcome,
      (fields) => fields.folderId === archive.id,
      "the move never reached the cell",
    );
    await browser(["wait", "--fn", `!document.querySelector('[role="dialog"]')`], DEADLINE_MS);

    ctx.log("an open item follows a rename another device made");
    expectEq(
      parseEval(await browser(["eval", doubleClickCard(ids.field)]), z.string()),
      "opened",
      "the card's double-click",
    );
    await browser(["wait", EDITOR], DEADLINE_MS);
    await library.items.organize({ ids: [ids.field], title: RENAMED });
    await pollUntil(
      async () => await browser(["get", "value", TITLE_FIELD]),
      (value) => value === RENAMED,
      { deadlineMs: DEADLINE_MS, describe: (value) => `the open item's title stayed "${value}"` },
    );
    await untilItemParam(browser, ids.field);

    ctx.log("a link pasted onto the grid and a file dropped on it are saved as items");
    await browser(["click", BACK_TO_LIBRARY]);
    await browser(["wait", LIBRARY_GRID], DEADLINE_MS);
    await browser(["eval", PASTE]);
    expectEq(parseEval(await browser(["eval", DROP]), z.string()), "dropped", "the drop");
    await pollUntil(
      async () => {
        const listed = await library.items.list({});
        return listed.items;
      },
      (items) =>
        items.some((item) => item.url === PASTED) &&
        items.some((item) => item.kind === "file" && item.title.includes("field-notes")),
      {
        deadlineMs: DEADLINE_MS,
        describe: (items) =>
          `the cell never held the pasted link and the dropped file: ${JSON.stringify(items.map((item) => [item.kind, item.title, item.url]))}`,
      },
    );
  },
};
