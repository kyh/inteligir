import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { parseEval } from "../harness/agent-browser";
import { expect } from "../harness/assert";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { EDITOR, treeRow } from "../harness/selectors";

// not the note the virgin boot opens (the listing puts folders first), so the pin is a closed
// note's guarded write and the reload below names the moved note rather than trusting the boot.
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

// the row's actions button is a sibling of the row, not a child: a button cannot nest a button
const rowActions = (vaultPath: string): string =>
  `[role="tree"] li:has([data-path="${vaultPath}"]) [data-sidebar="menu-action"]`;

const readOrNull = async (filePath: string): Promise<string | null> =>
  await readFile(filePath, "utf-8").catch(() => null);

interface MoveState {
  moved: string | null;
  original: string | null;
}

export const treeOpsBrowser: Scenario = {
  description:
    "the tree's row menu pins a note into its frontmatter, and a drag moves it with its image",
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

    ctx.log(`opening ${app.baseUrl}/`);
    await agentBrowser.openWorkspace(app);

    ctx.log("the rail opens on Files on a fresh profile");
    await agentBrowser(["wait", treeRow(NOTE)], 30_000);

    ctx.log("Pin from the row menu lands pinned: true in the frontmatter");
    await agentBrowser(["click", rowActions(NOTE)]);
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

    ctx.log(`dragging ${NOTE} onto ${FOLDER}/ moves it`);
    await agentBrowser(["drag", treeRow(NOTE), treeRow(FOLDER)]);
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
      path: `/?note=${encodeURIComponent(`${FOLDER}/${NOTE}`)}`,
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
