import { z } from "zod";
import { modChord, parseEval } from "../harness/agent-browser";
import type { AgentBrowser } from "../harness/agent-browser";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { openLibraryTab } from "../harness/library-tab";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { EDITOR, PALETTE_INPUT, libraryCard } from "../harness/selectors";

const NEEDLE = "zebrafish";
const FIRST = { markdown: "# One\n\nThe zebrafish swims.\n", title: "One" };
const SECOND = {
  markdown: "# Two\n\nAnother zebrafish here, and a zebrafish there.\n",
  title: "Two",
};
const ELSEWHERE = { markdown: "# Three\n\nNothing to find in here.\n", title: "Three" };
const FIND_BAR_INPUT = 'input[aria-label="Find"]';
const DEADLINE_MS = 20_000;

const HITS = `JSON.stringify([...document.querySelectorAll('[data-search-hit]')].map((row) => row.dataset.searchHit))`;

// the palette's hits, by the items they open, once there are `count` of them
const untilHits = async (browser: AgentBrowser, count: number): Promise<readonly string[]> =>
  await pollUntil(
    async () => parseEval(await browser(["eval", HITS]), z.array(z.string())),
    (hits) => hits.length === count,
    {
      deadlineMs: DEADLINE_MS,
      describe: (hits) => `expected ${String(count)} hits, saw ${JSON.stringify(hits)}`,
    },
  );

const FIND_LANDED = `JSON.stringify({
  body: String(document.querySelector('${EDITOR}')?.textContent ?? ""),
  value: String(document.querySelector('${FIND_BAR_INPUT}')?.value ?? ""),
})`;

export const librarySearchBrowser: Scenario = {
  description:
    "the palette searches the library in the cell: every item that holds the words is a hit and no other, and a hit opens its item with the find bar on them",
  name: "library-search-browser",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const ids: string[] = [];
    const { browser } = await openLibraryTab(ctx, "library-search", {
      seed: async (library) => {
        for (const note of [FIRST, SECOND, ELSEWHERE]) {
          const { item } = await library.items.createNote(note);
          ids.push(item.id);
        }
      },
    });
    const [firstId, secondId] = ids;
    if (firstId === undefined || secondId === undefined) {
      throw new Error("the seed made no items");
    }
    await browser(["wait", libraryCard(secondId)], DEADLINE_MS);

    ctx.log("the palette lists the two items that hold the words");
    await browser(["press", modChord("p")]);
    await browser(["wait", PALETTE_INPUT], DEADLINE_MS);
    await browser(["fill", PALETTE_INPUT, NEEDLE]);
    const hits = await untilHits(browser, 2);
    const listed = new Set(hits);
    if (!listed.has(firstId) || !listed.has(secondId)) {
      throw new Error(`the hits are not the two items: ${JSON.stringify(hits)}`);
    }

    ctx.log("a hit opens its item, the find bar on the words");
    await browser(["click", `[data-search-hit="${secondId}"]`]);
    await pollUntil(
      async () =>
        parseEval(
          await browser(["eval", FIND_LANDED]),
          z.object({ body: z.string(), value: z.string() }),
        ),
      (landed) => landed.value === NEEDLE && landed.body.includes("Another zebrafish"),
      {
        deadlineMs: DEADLINE_MS,
        describe: (landed) =>
          `the pick never landed: the find bar holds ${JSON.stringify(landed.value)}, the editor shows:\n${landed.body.slice(0, 300)}`,
      },
    );
  },
};
