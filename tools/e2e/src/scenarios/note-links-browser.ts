import { z } from "zod";
import { caretToEndOf, dragSelectParagraph, parseEval, press } from "../harness/agent-browser";
import type { AgentBrowser } from "../harness/agent-browser";
import { expect } from "../harness/assert";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { openLibraryTab, untilItemText } from "../harness/library-tab";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { EDITOR, OPTION } from "../harness/selectors";

const DEADLINE_MS = 30_000;
const FOLDER = "Birds";

const PASSAGE = "Herons wait before they strike.";
const STAYS = "This paragraph stays where it is.";
const EXTRACT = 'button[aria-label="Extract to new note"]';

// the item a bound formula reads, by its pill's id
const SIZES = ':formula[40]{meta="id=fb;name=base" source="40"}\n';

const NEW_NOTE = "Wading birds";

// the `[[` picker's rows as drawn, polled since the combobox portals outside the layout flow
const untilRows = async (
  browser: AgentBrowser,
  done: (rows: readonly string[]) => boolean,
  what: string,
): Promise<void> => {
  await pollUntil(
    async () =>
      parseEval(
        await browser([
          "eval",
          `JSON.stringify([...document.querySelectorAll('${OPTION}')].map((n) => n.textContent))`,
        ]),
        z.array(z.string()),
      ),
    done,
    { deadlineMs: DEADLINE_MS, describe: (rows) => `${what}: ${JSON.stringify(rows)}` },
  );
};

const source = (sizesId: string): string =>
  `# Field notes\n\nDouble it: :formula[0]{meta="id=fa;name=bigger" source="@(base#${sizesId}#fb)+2"}\n\n${PASSAGE}\n\n${STAYS}\n`;

export const noteLinksBrowser: Scenario = {
  description:
    "in the tab: a formula bound to another item reads its pill; Extract to new note moves a paragraph into a note of its own in the item's folder, linked by id where it was; and typing [[ opens a picker over the library's titles, whose Enter links the lit item by its id and whose Create makes a note of the words typed and links it",
  name: "note-links-browser",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    let sourceId = "";
    let sizesId = "";
    let folderId = "";
    const { browser, library } = await openLibraryTab(ctx, "note-links", {
      path: () => `?item=${sourceId}`,
      ready: EDITOR,
      seed: async (seeding) => {
        const sizes = await seeding.items.createNote({ markdown: SIZES, title: "Sizes" });
        sizesId = sizes.item.id;
        const { item } = await seeding.items.createNote({
          folder: { path: FOLDER },
          markdown: source(sizes.item.id),
          title: "Field notes",
        });
        sourceId = item.id;
        const { folders } = await seeding.organize.outline();
        folderId = folders.find((folder) => folder.name === FOLDER)?.id ?? "";
      },
    });

    ctx.log("the bound formula reads the other item's pill, and its display reaches the cell");
    await untilItemText(
      library,
      sourceId,
      (markdown) => markdown.includes(':formula[42]{meta="id=fa;name=bigger"'),
      "the bound formula never read 42",
    );

    ctx.log("selecting the passage and extracting it");
    await dragSelectParagraph(browser, EDITOR, PASSAGE, DEADLINE_MS);
    await press(browser, EXTRACT, DEADLINE_MS);

    ctx.log("the note it made holds the passage, in the source's folder");
    const made = await pollUntil(
      async () => {
        const { items } = await library.items.list({ folderId, limit: 50 });
        return items.find((row) => row.title === PASSAGE) ?? null;
      },
      (row) => row !== null,
      { deadlineMs: DEADLINE_MS, describe: () => "the extracted note never reached the cell" },
    );
    if (made === null) {
      throw new Error("the extracted note never reached the cell");
    }
    await untilItemText(
      library,
      made.id,
      (markdown) => markdown.includes(PASSAGE),
      "the extracted note does not hold the passage",
    );

    ctx.log("and the source holds a link to it by its id where the passage was");
    const left = await untilItemText(
      library,
      sourceId,
      (markdown) => markdown.includes(`(mention:${made.id})`),
      "the source never linked the extracted note",
    );
    expect(!left.includes(`\n${PASSAGE}\n`), `the passage stayed in the source as well:\n${left}`);
    expect(left.includes(STAYS), `the paragraph after it went too:\n${left}`);

    ctx.log("typing [[ opens the picker on the library's titles, and Enter links the lit one");
    await caretToEndOf(browser, STAYS);
    await browser(["keyboard", "type", " [["]);
    await untilRows(browser, (rows) => rows.length > 0, "the picker never opened");
    await browser(["keyboard", "type", "Siz"]);
    await untilRows(browser, (rows) => rows[0] === "Sizes", "the query never lit Sizes");
    await browser(["press", "Enter"]);
    await untilItemText(
      library,
      sourceId,
      (markdown) => markdown.includes(`${STAYS} [Sizes](mention:${sizesId})`),
      "the picked item never reached the cell as a link by its id",
    );

    ctx.log("and Create makes a note of the words typed, linked where they were");
    await browser(["keyboard", "type", " [["]);
    await untilRows(browser, (rows) => rows.length > 0, "the picker never opened again");
    await browser(["keyboard", "type", NEW_NOTE]);
    await untilRows(
      browser,
      (rows) => rows.length === 1 && rows[0] === `Create ${NEW_NOTE}`,
      "the words never offered Create alone",
    );
    await browser(["press", "Enter"]);
    const created = await pollUntil(
      async () => {
        const { items } = await library.items.list({ folderId, limit: 50 });
        return items.find((row) => row.title === NEW_NOTE) ?? null;
      },
      (row) => row !== null,
      { deadlineMs: DEADLINE_MS, describe: () => "Create never made the note" },
    );
    if (created === null) {
      throw new Error("Create never made the note");
    }
    const linked = await untilItemText(
      library,
      sourceId,
      (markdown) => markdown.includes(`[${NEW_NOTE}](mention:${created.id})`),
      "the note Create made was never linked",
    );
    expect(!linked.includes("\\["), `a [ of the [[ stayed in the text:\n${linked}`);
  },
};
