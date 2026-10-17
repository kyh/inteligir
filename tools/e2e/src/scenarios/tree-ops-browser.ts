import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { parseEval } from "../harness/agent-browser";
import { expect } from "../harness/assert";
import { readOrNull } from "../harness/exec";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { EDITOR, folderRow, libraryCard } from "../harness/selectors";

// nothing is open at boot, so the pin is a closed item's guarded write and the reload below
// names the moved note by its deep link.
const NOTE = "Aardvark.md";
const PROSE = "A burrowing note.";
// the spaced name a paste writes as it is; the move re-bases it file-relative and percent-encoded
const ASSET = "assets/shot 1.png";
const DOC = `# Aardvark\n\n${PROSE}\n\n![shot](<${ASSET}>)\n`;
const REBASED_URL = "../assets/shot%201.png";
// a 1x1 transparent png
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const FOLDER = "zoo";
const FOLDER_NOTE = "Zebra.md";
const DISK_DEADLINE_MS = 30_000;
const IMAGE_DEADLINE_MS = 30_000;

// a right-click, as the browser sends one: the card selects itself and opens its menu
const openCardMenu = (vaultPath: string): string => `(() => {
  const card = document.querySelector(${JSON.stringify(libraryCard(vaultPath))});
  if (!card) return "missing";
  card.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  return "opened";
})()`;

const MENU_LABELS = `JSON.stringify([...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent?.trim() ?? ""))`;

interface MoveState {
  moved: string | null;
  original: string | null;
}

export const treeOpsBrowser: Scenario = {
  description:
    "the library opens on its grid; a card's menu pins an item into its frontmatter and then offers Unpin, and a card dragged onto a folder in the rail moves it, with its image still loading",
  name: "tree-ops-browser",
  async run(ctx) {
    const app = await ctx.boot({
      name: "solo",
      seedVault: async (vaultDir) => {
        await writeFile(path.join(vaultDir, NOTE), DOC, "utf-8");
        await mkdir(path.join(vaultDir, path.dirname(ASSET)), { recursive: true });
        await writeFile(path.join(vaultDir, ASSET), PNG);
        await mkdir(path.join(vaultDir, FOLDER), { recursive: true });
        await writeFile(path.join(vaultDir, FOLDER, FOLDER_NOTE), "# Zebra\n", "utf-8");
      },
    });
    const agentBrowser = await ctx.browser("tree-ops");

    ctx.log(`opening ${app.baseUrl}/ on the library`);
    await agentBrowser.openWorkspace(app);
    await agentBrowser(["wait", libraryCard(NOTE)], 30_000);

    ctx.log("Pin from the card's menu lands pinned: true in the frontmatter");
    expect(
      parseEval(await agentBrowser(["eval", openCardMenu(NOTE)]), z.string()) === "opened",
      `no card for ${NOTE}`,
    );
    await agentBrowser(["find", "role", "menuitem", "click", "--name", "Pin", "--exact"]);
    const pinned = await pollUntil(
      async () => (await readOrNull(path.join(app.vaultDir, NOTE))) ?? "",
      (bytes) => bytes.includes("pinned: true"),
      {
        deadlineMs: DISK_DEADLINE_MS,
        describe: (bytes) => `the pin never reached disk:\n${bytes}`,
      },
    );
    expect(pinned.endsWith(DOC), `the pin rewrote more than the frontmatter:\n${pinned}`);

    // the card's row is the index's, which the pin's settle moves: the card's verb must follow
    // the bytes without a reload
    ctx.log("the card's menu then offers Unpin");
    await pollUntil(
      async () => {
        await agentBrowser(["eval", openCardMenu(NOTE)]);
        const labels = parseEval(await agentBrowser(["eval", MENU_LABELS]), z.array(z.string()));
        await agentBrowser(["press", "Escape"]);
        return labels;
      },
      (labels) => labels.includes("Unpin"),
      {
        deadlineMs: DISK_DEADLINE_MS,
        describe: (labels) => `the card's menu never offered Unpin: ${labels.join(", ")}`,
      },
    );

    ctx.log(`dragging ${NOTE}'s card onto ${FOLDER} in the rail moves it`);
    await agentBrowser(["wait", folderRow(FOLDER)], 30_000);
    await agentBrowser(["drag", libraryCard(NOTE), folderRow(FOLDER)]);
    const { moved } = await pollUntil(
      async (): Promise<MoveState> => ({
        moved: await readOrNull(path.join(app.vaultDir, FOLDER, NOTE)),
        original: await readOrNull(path.join(app.vaultDir, NOTE)),
      }),
      // a move lands the rename, then rewrites the moved note's own links: wait for both
      (state): state is { moved: string; original: null } =>
        state.moved !== null && state.original === null && state.moved.includes(REBASED_URL),
      {
        deadlineMs: DISK_DEADLINE_MS,
        describe: (state) =>
          state.moved !== null && state.original === null
            ? `the move did not re-base the image:\n${state.moved}`
            : `the drop never moved the note: ${FOLDER}/${NOTE} ${state.moved === null ? "absent" : "present"}, ${NOTE} ${state.original === null ? "absent" : "present"}`,
      },
    );
    expect(moved.includes("pinned: true"), `the move dropped the frontmatter:\n${moved}`);

    // a fresh load, so no image the note drew before the move can answer for it
    ctx.log("the moved note's re-based image still loads");
    await agentBrowser.openWorkspace(app, {
      path: `/?item=${encodeURIComponent(`${FOLDER}/${NOTE}`)}`,
      ready: EDITOR,
    });
    await pollUntil(
      async () =>
        parseEval(
          await agentBrowser([
            "eval",
            `JSON.stringify({ text: document.querySelector('${EDITOR}')?.textContent ?? "", loaded: document.querySelectorAll('${EDITOR} img[src^="blob:"]').length })`,
          ]),
          z.object({ loaded: z.number(), text: z.string() }),
        ),
      (state) => state.text.includes(PROSE) && state.loaded > 0,
      {
        deadlineMs: IMAGE_DEADLINE_MS,
        describe: (state) =>
          `the moved note never drew its image; the editor holds:\n${state.text}`,
      },
    );
  },
};
