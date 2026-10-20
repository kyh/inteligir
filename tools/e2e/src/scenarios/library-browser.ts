import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  clickStartingWith,
  openItemParam,
  parseEval,
  untilBodyHolds,
} from "../harness/agent-browser";
import type { AgentBrowser } from "../harness/agent-browser";
import { agentShellCli } from "../harness/agent-shell-cli";
import { expect, expectEq } from "../harness/assert";
import { readOrNull } from "../harness/exec";
import { pollUntil } from "../harness/poll";
import { reserveFreePorts } from "../harness/ports";
import type { Scenario } from "../harness/scenario";
import {
  BACK_TO_LIBRARY,
  EDITOR,
  LIBRARY_GRID,
  LIBRARY_TITLE,
  clickCard,
  folderRow,
  libraryCard,
} from "../harness/selectors";

const WELCOME = "Welcome.md";
const FIELD = "Reading/Field notes.md";
const FIELD_RENAMED = "Reading/Field journal.md";
const FIELD_PROSE = "Notes from the field.";
const PIER = "Photos/Pier.md";
const PIER_IMAGE = "assets/pier.png";
const DROPPED_NAME = "dropped.png";
const DROPPED = "Unsorted/dropped.md";
const READING = "Reading";
const TAG = "field";
const INFO_TAG = "e2e";
// a 1x1 transparent png
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const DEADLINE_MS = 30_000;
const SAVED = "saved: 2026-10-01T09:00:00Z";

// each with the id and the saved date every item the app makes carries; Field notes' id is what
// lets the open window follow it through the rename
const SEED = {
  [FIELD]: `---\nid: 5b1c0f8e-6f0a-4d8e-9a51-1c2b3d4e5f60\n${SAVED}\ntags:\n  - ${TAG}\n---\n# Field notes\n\n${FIELD_PROSE}\n`,
  [PIER]: `---\nid: 2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f\nkind: image\n${SAVED}\n---\n![](${PIER_IMAGE})\n`,
  [WELCOME]: `---\nid: 0e5b3c1a-9a51-4f0e-8a0c-0b7f9d3a2c11\n${SAVED}\n---\n# Welcome\n\nStart here.\n`,
} satisfies Readonly<Record<string, string>>;

const CARD_PATHS = `JSON.stringify([...document.querySelectorAll('[role="gridcell"][data-item-path]')].map((card) => card.dataset.itemPath))`;
const TITLE_TEXT = `String(document.querySelector('${LIBRARY_TITLE}')?.textContent ?? "")`;
const DIALOG_TEXT = `String(document.querySelector('[role="dialog"]')?.textContent ?? "")`;

const untilCards = async (
  browser: AgentBrowser,
  holds: (paths: readonly string[]) => boolean,
  what: string,
): Promise<readonly string[]> =>
  await pollUntil(
    async () => parseEval(await browser(["eval", CARD_PATHS]), z.array(z.string())),
    holds,
    {
      deadlineMs: DEADLINE_MS,
      describe: (paths) => `${what}; the grid shows ${paths.join(", ")}`,
    },
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

const untilDisk = async (
  file: string,
  holds: (text: string | null) => boolean,
  what: string,
): Promise<string | null> =>
  await pollUntil(async () => await readOrNull(file), holds, {
    deadlineMs: DEADLINE_MS,
    describe: (text) => `${what}; the file holds:\n${text ?? "(nothing)"}`,
  });

// where Info's panel stands and a card sits: the panel opens and closes as a width tween, and the
// grid re-derives its columns from the width the panel leaves it, so a card changes rows under it
const PANEL = '[data-slot="sidebar"][data-side="right"]';
const layoutOf = (card: string): string => `JSON.stringify((() => {
  const panel = document.querySelector(${JSON.stringify(PANEL)});
  const box = document.querySelector(${JSON.stringify(card)})?.getBoundingClientRect();
  return {
    card: box === undefined ? null : [Math.round(box.x), Math.round(box.y)],
    panel: panel?.getAttribute("data-state") ?? null,
    width: panel === null ? null : Math.round(panel.getBoundingClientRect().width),
  };
})())`;
const layoutSchema = z.object({
  card: z.tuple([z.number(), z.number()]).nullable(),
  panel: z.string().nullable(),
  width: z.number().nullable(),
});

// a pointer gesture is aimed at a point read before it is sent, so after a toggle the next one waits
// for the tween to end and for the card it will aim at to stand where the read before found it
const untilPanelSettled = async (
  browser: AgentBrowser,
  open: boolean,
  card: string,
): Promise<void> => {
  let previous: string | null = null;
  await pollUntil(
    async () => {
      const layout = parseEval(await browser(["eval", layoutOf(card)]), layoutSchema);
      const seen = JSON.stringify(layout);
      const steady = seen === previous;
      previous = seen;
      return { layout, steady };
    },
    ({ layout, steady }) =>
      steady &&
      layout.card !== null &&
      layout.panel === (open ? "expanded" : "collapsed") &&
      (open ? (layout.width ?? 0) > 0 : layout.width === 0),
    {
      deadlineMs: DEADLINE_MS,
      describe: ({ layout }) =>
        `the panel never settled ${open ? "open" : "closed"}: ${JSON.stringify(layout)}`,
    },
  );
};

const select = async (browser: AgentBrowser, file: string): Promise<void> => {
  expectEq(parseEval(await browser(["eval", clickCard(file)]), z.string()), "clicked", file);
};

// what a paste and a drop carry, built in the page the way the browser hands them over
const pasteScript = (url: string): string => `(() => {
  const data = new DataTransfer();
  data.setData("text/plain", ${JSON.stringify(url)});
  document.body.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  return "pasted";
})()`;

const DROP_SCRIPT = `(() => {
  const bytes = Uint8Array.from(atob(${JSON.stringify(PNG_BASE64)}), (char) => char.charCodeAt(0));
  const data = new DataTransfer();
  data.items.add(new File([bytes], ${JSON.stringify(DROPPED_NAME)}, { type: "image/png" }));
  for (const type of ["dragenter", "dragover", "drop"]) {
    document.body.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }));
  }
  return "dropped";
})()`;

const isPastedLink = (file: string): boolean => file.startsWith("Unsorted/") && file !== DROPPED;

export const libraryBrowser: Scenario = {
  description:
    "the seeded grid draws; open, Back and Forward; folder, tag and kind scopes; a pasted link and a dropped image become cards; a card dragged to a folder moves; Space opens Quick Look; an Info tag lands on disk; an open item follows its rename",
  name: "library-browser",
  async run(ctx) {
    const app = await ctx.boot({
      name: "solo",
      seedVault: async (vaultDir) => {
        for (const [file, content] of Object.entries(SEED)) {
          await mkdir(path.join(vaultDir, path.dirname(file)), { recursive: true });
          await writeFile(path.join(vaultDir, file), content, "utf-8");
        }
        await mkdir(path.join(vaultDir, "assets"), { recursive: true });
        await writeFile(path.join(vaultDir, PIER_IMAGE), Buffer.from(PNG_BASE64, "base64"));
      },
    });
    const vault = (file: string): string => path.join(app.vaultDir, file);
    const browser = await ctx.browser("library");

    ctx.log("the window opens on the library, one card per item");
    await browser.openWorkspace(app);
    await untilCards(
      browser,
      (paths) => [WELCOME, FIELD, PIER].every((file) => paths.includes(file)),
      "the seeded items never all drew",
    );
    expectEq(await openItemParam(browser), null, "the url while the library shows");

    ctx.log("a double-click opens an item; Back is the library, Forward the item again");
    await browser(["dblclick", libraryCard(WELCOME)]);
    await browser(["wait", EDITOR], DEADLINE_MS);
    await untilItemParam(browser, WELCOME);
    await browser(["click", 'button[aria-label="Back"]']);
    await browser(["wait", LIBRARY_GRID], DEADLINE_MS);
    await untilItemParam(browser, null);
    await browser(["click", 'button[aria-label="Forward"]']);
    await browser(["wait", EDITOR], DEADLINE_MS);
    await untilItemParam(browser, WELCOME);
    await browser(["click", BACK_TO_LIBRARY]);
    await browser(["wait", LIBRARY_GRID], DEADLINE_MS);

    ctx.log("a folder in the rail narrows the grid to what is in it");
    await browser(["click", folderRow(READING)]);
    await untilTitle(browser, READING);
    await untilCards(
      browser,
      (paths) => paths.includes(FIELD) && !paths.includes(WELCOME),
      "the folder scope never narrowed",
    );

    ctx.log("a tag in the rail narrows it to the tag's items");
    await browser(["click", `[aria-label="Tags"] [data-tag="${TAG}"]`]);
    await untilTitle(browser, `#${TAG}`);
    await untilCards(
      browser,
      (paths) => paths.length === 1 && paths[0] === FIELD,
      "the tag scope never narrowed",
    );

    ctx.log("a kind chip narrows All items to that kind, and lets go again");
    await clickStartingWith(browser, '[aria-label="Library"]', "All items");
    await untilTitle(browser, "All items");
    await clickStartingWith(browser, '[aria-label="Kind"]', "Images");
    await untilCards(
      browser,
      (paths) => paths.length === 1 && paths[0] === PIER,
      "the Images chip never narrowed",
    );
    await clickStartingWith(browser, '[aria-label="Kind"]', "Images");
    await untilCards(browser, (paths) => paths.includes(WELCOME), "the chip never let go");

    ctx.log("a link pasted where nothing takes text is saved to Unsorted as a card");
    // a port nothing listens on, which the guarded fetch refuses: whatever the fill makes of it,
    // the card and its url are there (§0.2.9)
    const [closed = 0] = await reserveFreePorts(1);
    const link = `http://127.0.0.1:${String(closed)}/`;
    await browser(["click", LIBRARY_TITLE]);
    await browser(["eval", pasteScript(link)]);
    const withLink = await untilCards(
      browser,
      (paths) => paths.some(isPastedLink),
      "the pasted link never became a card",
    );
    const saved = withLink.find(isPastedLink) ?? "";
    await untilDisk(
      vault(saved),
      (text) => text?.includes(`url: ${link}`) === true,
      `${saved} does not hold the pasted url`,
    );

    ctx.log("an image dropped on the window is saved as an image item");
    await browser(["eval", DROP_SCRIPT]);
    await untilCards(browser, (paths) => paths.includes(DROPPED), "the drop never became a card");
    const wrapper = await untilDisk(
      vault(DROPPED),
      (text) => text?.includes("kind: image") === true,
      "the dropped file has no image item",
    );
    expect(wrapper?.includes(DROPPED_NAME) === true, "the image item does not embed its original");

    ctx.log("a card dragged onto a folder in the rail moves the item there");
    await browser(["drag", libraryCard(DROPPED), folderRow(READING)]);
    await untilDisk(
      vault(`${READING}/dropped.md`),
      (text) => text !== null,
      "the dragged item never reached the folder",
    );
    // the move links the new path, then unlinks the old one, so the old place is waited out too
    await untilDisk(vault(DROPPED), (text) => text === null, "the dragged item's old place stayed");

    ctx.log("Space on the selected card is Quick Look, and Escape closes it");
    await select(browser, WELCOME);
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

    ctx.log("a tag added in Info lands as a frontmatter line");
    await select(browser, WELCOME);
    await browser(["click", 'button[aria-label="Toggle panel"]']);
    // the toggle rides the top bar's right end, which the opening panel pushes along
    await untilPanelSettled(browser, true, libraryCard(FIELD));
    await browser(["wait", 'input[aria-label="tags tags"]'], DEADLINE_MS);
    await browser(["fill", 'input[aria-label="tags tags"]', INFO_TAG]);
    await browser(["press", "Enter"]);
    await untilDisk(
      vault(WELCOME),
      (text) => text?.includes(`tags:\n  - ${INFO_TAG}`) === true,
      "Info's tag never reached the file",
    );
    await browser(["click", 'button[aria-label="Toggle panel"]']);
    // closing hands the grid a fourth column, which moves Field notes up a row
    await untilPanelSettled(browser, false, libraryCard(FIELD));

    ctx.log("an open item renamed from the command line stays open at its new path");
    await browser(["dblclick", libraryCard(FIELD)]);
    // the url first: an open the double-click never made fails naming what the window shows
    await untilItemParam(browser, FIELD);
    await browser(["wait", EDITOR], DEADLINE_MS);
    const cli = agentShellCli(ctx.repoRoot, app.dataDir);
    await cli("vault", "rename", FIELD, FIELD_RENAMED);
    await untilItemParam(browser, FIELD_RENAMED);
    await browser(["wait", EDITOR], DEADLINE_MS);
    await untilBodyHolds(browser, [FIELD_PROSE]);
  },
};
