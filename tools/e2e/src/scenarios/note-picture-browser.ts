import { createHash } from "node:crypto";

import { LIBRARY_PAGE_PATH } from "@repo/contract/cloud/library-page";
import { z } from "zod";

import { caretToEndOf, parseEval } from "../harness/agent-browser";
import type { ScenarioBrowser } from "../harness/agent-browser";
import { expect } from "../harness/assert";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { openLibraryTab, untilItemText } from "../harness/library-tab";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { EDITOR } from "../harness/selectors";

const DEADLINE_MS = 30_000;
const PARAGRAPH = "The heron at the weir, this morning.";

// a 1x1 transparent png
const PIXEL_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const PIXEL_SHA = createHash("sha256").update(Buffer.from(PIXEL_BASE64, "base64")).digest("hex");

// a screenshot pasted into the note's text as the browser hands one over: a file, and no markup
const PASTE_PICTURE = `(() => {
  const editable = document.querySelector(${JSON.stringify(EDITOR)});
  if (!editable) return "missing";
  const bytes = Uint8Array.from(atob(${JSON.stringify(PIXEL_BASE64)}), (c) => c.codePointAt(0));
  const data = new DataTransfer();
  data.items.add(new File([bytes], "heron.png", { type: "image/png" }));
  editable.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  return "pasted";
})()`;

// the note's picture as the editor drew it: its address's scheme and its decoded width, or none
const DRAWN = `JSON.stringify((() => {
  const img = document.querySelector(${JSON.stringify(`${EDITOR} img`)});
  return img === null ? { blob: false, width: -1 } : { blob: img.src.startsWith("blob:"), width: img.complete ? img.naturalWidth : 0 };
})())`;

const drawnSchema = z.object({ blob: z.boolean(), width: z.number() });

const untilDrawn = async (browser: ScenarioBrowser, where: string): Promise<void> => {
  await pollUntil(
    async () => parseEval(await browser(["eval", DRAWN]), drawnSchema),
    (drawn) => drawn.blob && drawn.width === 1,
    {
      deadlineMs: DEADLINE_MS,
      describe: (drawn) => `${where}, the note's picture never drew: ${JSON.stringify(drawn)}`,
    },
  );
};

export const notePictureBrowser: Scenario = {
  description:
    "in the tab: a picture pasted into a note's text is kept by its sha and drawn at once from the bytes the tab holds, goes up ahead of the write that names it, and is drawn again from the cloud after a reload and in a second browser signed in to the same library",
  name: "note-picture-browser",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    let noteId = "";
    const { browser, library, worker } = await openLibraryTab(ctx, "note-picture", {
      path: () => `?item=${noteId}`,
      ready: EDITOR,
      seed: async (seeding) => {
        const { item } = await seeding.items.createNote({
          markdown: `${PARAGRAPH}\n`,
          title: "Field notes",
        });
        noteId = item.id;
      },
    });

    ctx.log("a picture pasted at the end of the paragraph draws at once, from the tab's own bytes");
    await caretToEndOf(browser, PARAGRAPH);
    expect(
      parseEval(await browser(["eval", PASTE_PICTURE]), z.string()) === "pasted",
      "the editor was not there to paste into",
    );
    await untilDrawn(browser, "in the tab that pasted it");

    // the cell takes no write naming a file it does not hold, so the landing says the bytes went
    // up first
    ctx.log("the cell holds the note naming the picture by its sha, the paragraph kept");
    const landed = await untilItemText(
      library,
      noteId,
      (markdown) => markdown.includes(`assets/${PIXEL_SHA}`),
      "the note never named the pasted picture",
    );
    expect(landed.includes(PARAGRAPH), `the paragraph went with the paste:\n${landed}`);

    ctx.log("a reload pulls the library again, and the picture draws from the cloud");
    await browser(["open", `${worker.origin}${LIBRARY_PAGE_PATH}?item=${noteId}`], 60_000);
    await browser(["wait", EDITOR], 90_000);
    await untilDrawn(browser, "after a reload");

    ctx.log("a second browser signed in to the library draws it too");
    const second = await ctx.browser("note-picture-second");
    await second.openLibrary(worker, { path: `?item=${noteId}`, ready: EDITOR });
    await untilDrawn(second, "in a second browser");
  },
};
