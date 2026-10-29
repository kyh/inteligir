// desktop-shell's long-article step, on WebKitGTK through tauri-driver: WebKit keeps no scroll
// anchor, so the runs of blocks a long note draws in (packages/editor/src/run-anchoring.ts) keep
// one themselves. A run off screen holds an estimate of its height, far from a run of article
// paragraphs' real one: a far jump must land on its target and hold still while the run above it
// draws, and scrolling back up must move the text exactly as far as the scroll, with no leap
// where a run draws. Chromium keeps its own anchor, so only this engine can show either.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { expect, expectEq } from "../../harness/assert";
import type { ScenarioContext } from "../../harness/scenario";
import { LIBRARY_GRID, doubleClickCard, libraryCard } from "../../harness/selectors";
import type { WebDriverSession } from "../../harness/webdriver";

const ITEM = "Reading/A long article.md";
const FIND_INPUT = 'input[aria-label="Find"]';
const PAGE_DEADLINE_MS = 60_000;
// a run is 100 blocks; eight of them, a heading every tenth block among article paragraphs
const RUNS = 8;
const LOREM =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.";
// what a frame's rounding may move a block by
const STILL_PX = 4;
const SCROLL_STEP_PX = 300;
const SCROLL_STEPS = 40;

const article = (): string => {
  const blocks: string[] = [];
  for (let run = 0; run < RUNS; run += 1) {
    for (let block = 0; block < 100; block += 1) {
      blocks.push(
        block % 10 === 0
          ? `## Part ${String(run)}.${String(block)}`
          : `Run ${String(run)} block ${String(block)}. ${LOREM}`,
      );
    }
  }
  return `---\nsaved: 2026-10-01T09:00:00Z\n---\n${blocks.join("\n\n")}\n`;
};

export const seedLongArticle = async (vaultDir: string): Promise<void> => {
  await mkdir(path.join(vaultDir, path.dirname(ITEM)), { recursive: true });
  await writeFile(path.join(vaultDir, ITEM), article());
};

// the page-side helpers every probe below uses: the scroller, a block by its opening words, its
// top from the scroller's, and a wait of some frames
const HELPERS = `
  const scroller = document.querySelector("[data-editor-scroller]");
  const block = (words) => [...document.querySelectorAll("[data-slate-chunk] > *")].find((el) => el.textContent.startsWith(words));
  const top = (el) => Math.round(el.getBoundingClientRect().top - scroller.getBoundingClientRect().top);
  const frames = (n) => new Promise((resolve) => { const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step)); requestAnimationFrame(step); });
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
`;

const landingSchema = z.object({ landed: z.number(), settled: z.number(), view: z.number() });

// a far jump as the find bar makes one: the words typed into it, then Enter, which reveals the
// match (scroll-reveal.ts), and the run above the match draws once it has landed
const findAndJump = async (
  page: WebDriverSession,
  words: string,
): Promise<z.infer<typeof landingSchema>> =>
  await page.runAsync(
    `${HELPERS}
    (async () => {
      const input = document.querySelector(${JSON.stringify(FIND_INPUT)});
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setValue.call(input, ${JSON.stringify(words)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await frames(2);
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }));
      const target = block(${JSON.stringify(words)});
      const landed = top(target);
      await frames(10);
      await pause(500);
      done({ landed, settled: top(target), view: scroller.clientHeight });
    })();`,
    landingSchema,
  );

// the match lands in view and stays where it landed
const expectHeld = ({ landed, settled, view }: z.infer<typeof landingSchema>): void => {
  expect(
    landed >= 0 && landed < view,
    `the match landed at ${String(landed)}px, outside the ${String(view)}px view`,
  );
  expect(
    Math.abs(settled - landed) <= STILL_PX,
    `the match landed at ${String(landed)}px and moved to ${String(settled)}px`,
  );
};

const climbSchema = z.object({ leaps: z.array(z.number()), steps: z.number() });

const climb = async (page: WebDriverSession, words: string): Promise<z.infer<typeof climbSchema>> =>
  await page.runAsync(
    `${HELPERS}
    (async () => {
      const target = block(${JSON.stringify(words)});
      const leaps = [];
      let steps = 0;
      for (let step = 0; step < ${String(SCROLL_STEPS)} && scroller.scrollTop > 0; step += 1) {
        const before = top(target);
        const scroll = Math.min(${String(SCROLL_STEP_PX)}, scroller.scrollTop);
        scroller.scrollTop -= scroll;
        // what a frame paints comes after the anchor has answered a run's draw, so the text is
        // read once it has stopped moving
        let seen = null;
        for (let wait = 0; wait < 20; wait += 1) {
          await frames(2);
          const now = top(target);
          if (now === seen) break;
          seen = now;
        }
        const moved = seen - before;
        if (Math.abs(moved - scroll) > ${String(STILL_PX)}) leaps.push(moved - scroll);
        steps += 1;
      }
      done({ leaps, steps });
    })();`,
    climbSchema,
  );

// from the library: the article opens from its card, and the find bar's far jumps and the scroll
// back up are measured in it
export const farJumpsHold = async (ctx: ScenarioContext, page: WebDriverSession): Promise<void> => {
  await page.waitUntil(
    `document.querySelector(${JSON.stringify(LIBRARY_GRID)}) !== null`,
    PAGE_DEADLINE_MS,
  );
  const card = libraryCard(ITEM);
  await page.waitUntil(
    `document.querySelector(${JSON.stringify(card)}) !== null`,
    PAGE_DEADLINE_MS,
  );
  expectEq(await page.run(`return ${doubleClickCard(ITEM)};`, z.string()), "double-clicked", ITEM);
  await page.waitUntil(`document.querySelector("[data-slate-editor]") !== null`, PAGE_DEADLINE_MS);
  const shown = await page.run(
    `return { runs: document.querySelectorAll("[data-slate-chunk]").length, blocks: document.querySelector("[data-slate-editor]").children.length, raw: document.querySelector("textarea") !== null }`,
    z.object({ blocks: z.number(), raw: z.boolean(), runs: z.number() }),
  );
  ctx.log(`the article opened as ${JSON.stringify(shown)}`);
  await page.clickButton("Find", PAGE_DEADLINE_MS);
  await page.waitUntil(
    `document.querySelector(${JSON.stringify(FIND_INPUT)}) !== null`,
    PAGE_DEADLINE_MS,
  );
  const anchoring = await page.run(`return CSS.supports("overflow-anchor", "auto")`, z.boolean());
  ctx.log(`this engine keeps its own scroll anchor: ${String(anchoring)}`);

  ctx.log("a far jump to a run's second block lands centred and holds while the run above draws");
  const near = await findAndJump(page, "Run 4 block 1.");
  expectHeld(near);

  ctx.log("a far jump to the middle of a run lands centred and holds");
  const middle = await findAndJump(page, "Run 6 block 51.");
  expectHeld(middle);

  ctx.log("scrolling back up moves the text exactly as far as the scroll, as each run above draws");
  const climbed = await climb(page, "Run 6 block 51.");
  expect(climbed.steps > 10, `the note scrolled up only ${String(climbed.steps)} steps`);
  expect(
    climbed.leaps.length === 0,
    `the text leapt by ${climbed.leaps.join(", ")}px while scrolling up`,
  );
};
