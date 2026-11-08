import { z } from "zod";
import {
  clickButtonIn,
  dragSelectParagraph,
  modChord,
  parseEval,
  untilBodyHolds,
} from "../harness/agent-browser";
import { expect, expectEq } from "../harness/assert";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { openLibraryTab } from "../harness/library-tab";
import type { Library } from "../harness/library-tab";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { EDITOR } from "../harness/selectors";

const TITLE = "Heron notes";
const PASSAGE = "Herons stand still for a long time before they strike.";
const DOC = `# ${TITLE}\n\n${PASSAGE}\n\nThe second paragraph stays plain.\n`;
const NOTE_TEXT = "Worth a second read";
const NOTE_FIELD = 'textarea[aria-label="Note"]';
const PANEL = '[data-side="right"]';
const DEADLINE_MS = 30_000;

const TINTED = `String(document.querySelectorAll('${EDITOR} .bg-highlight').length)`;

// whether the page draws the element where a person sees it: the point at its top is the element's
// own, not clipped away by a panel that left it no height
const shownAt = (selector: string): string => `(() => {
  const element = document.querySelector(${JSON.stringify(selector)});
  if (element === null) return "missing";
  const box = element.getBoundingClientRect();
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + Math.min(4, box.height / 2));
  return String(hit !== null && element.contains(hit));
})()`;

type Highlight = Awaited<ReturnType<Library["annotations"]["list"]>>["highlights"][number];

// the item's highlights as the cell holds them, once they hold what `holds` waits for
const untilHighlights = async (
  library: Library,
  itemId: string,
  holds: (highlights: readonly Highlight[]) => boolean,
  what: string,
): Promise<readonly Highlight[]> =>
  await pollUntil(
    async () => {
      const { highlights } = await library.annotations.list({ itemId });
      return highlights;
    },
    holds,
    {
      deadlineMs: DEADLINE_MS,
      describe: (highlights) => `${what}; the cell holds ${JSON.stringify(highlights)}`,
    },
  );

export const annotationsBrowser: Scenario = {
  description:
    "in the tab: select, ⌘⇧H, the highlight in the cell quoting the passage, its tint, a note saved from the popover, and its card in the panel's Highlights tab",
  name: "annotations-browser",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    let itemId = "";
    const { browser, library } = await openLibraryTab(ctx, "annotations", {
      path: () => `?item=${itemId}`,
      ready: EDITOR,
      seed: async (seeding) => {
        const { item } = await seeding.items.createNote({ markdown: DOC, title: TITLE });
        itemId = item.id;
      },
    });

    ctx.log("selecting the passage with the mouse, as a reader does");
    await dragSelectParagraph(browser, EDITOR, PASSAGE, DEADLINE_MS);

    ctx.log("⌘⇧H makes the highlight at once, with the passage it quotes, and offers a note");
    await browser(["press", modChord("Shift+h")]);
    const [made] = await untilHighlights(
      library,
      itemId,
      (highlights) => highlights.length === 1,
      "the highlight never reached the cell",
    );
    expect(made !== undefined, "the cell holds no highlight");
    expectEq(made.text, "", "a highlight's note before one is written");
    expect(
      made.quote?.includes("Herons stand still") === true,
      `the highlight does not quote the passage: ${String(made.quote)}`,
    );

    ctx.log("the highlight is tinted");
    await pollUntil(
      async () => parseEval(await browser(["eval", TINTED]), z.string()),
      (count) => count !== "0",
      { deadlineMs: DEADLINE_MS, describe: () => "the highlighted words were never tinted" },
    );

    ctx.log("a note typed in the popover is saved on Return");
    await browser(["wait", NOTE_FIELD], DEADLINE_MS);
    await browser(["fill", NOTE_FIELD, NOTE_TEXT]);
    await browser(["press", "Enter"]);
    await untilHighlights(
      library,
      itemId,
      (highlights) => highlights.some(({ id, text }) => id === made.id && text === NOTE_TEXT),
      "the note never reached the highlight",
    );

    ctx.log("the Highlights tab holds its card, the words and the note");
    await browser(["click", 'button[aria-label="Info, highlights and the agent"]']);
    // pressed where it is, not where a pointer finds it: the panel slides in as it opens
    await clickButtonIn(browser, PANEL, "Highlights");
    const card = `[data-annotation-id="${made.id}"]`;
    await browser(["wait", card], DEADLINE_MS);
    await pollUntil(
      async () => parseEval(await browser(["eval", shownAt(card)]), z.string()),
      (shown) => shown === "true",
      { deadlineMs: DEADLINE_MS, describe: (shown) => `the card was never in view (${shown})` },
    );
    await untilBodyHolds(browser, ["Herons stand still", "Remove highlight"]);
    expectEq(
      await browser(["get", "value", `${card} textarea[aria-label="Note"]`]),
      NOTE_TEXT,
      "the card's note",
    );
  },
};
