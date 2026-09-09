import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { agentBrowserSession, closeQuietly, probeHeadlessOrSkip } from "../harness/agent-browser";
import { expect } from "../harness/assert";
import type { Scenario } from "../harness/scenario";

const agentBrowser = agentBrowserSession("tree-ops");
// sorts before the seeded notes, so the virgin boot opens it: the pin then rides the open buffer.
const NOTE = "Aardvark.md";
const DOC = "# Aardvark\n\nA burrowing note.\n";
const FOLDER = "zoo";
const FOLDER_NOTE = "Zebra.md";
const EDITOR = '[data-slate-editor="true"]';
const DISK_DEADLINE_MS = 30_000;

const row = (vaultPath: string): string => `[role="tree"] [data-path="${vaultPath}"]`;

const readOrNull = async (filePath: string): Promise<string | null> =>
  await readFile(filePath, "utf-8").catch(() => null);

export const treeOpsBrowser: Scenario = {
  description: "the tree's row menu pins a note into its frontmatter, and a drag moves it",
  name: "tree-ops-browser",
  async run(ctx) {
    const app = await ctx.boot({
      name: "solo",
      seedVault: async (vaultDir) => {
        await writeFile(path.join(vaultDir, NOTE), DOC, "utf-8");
        await mkdir(path.join(vaultDir, FOLDER), { recursive: true });
        await writeFile(path.join(vaultDir, FOLDER, FOLDER_NOTE), "# Zebra\n", "utf-8");
      },
    });
    try {
      await probeHeadlessOrSkip(agentBrowser, ctx.log);

      ctx.log(`opening ${app.baseUrl}/`);
      await agentBrowser(["open", `${app.baseUrl}/`], 60_000);
      await agentBrowser(["wait", EDITOR], 90_000);

      ctx.log("the rail's Files section is open on a fresh profile");
      await agentBrowser(["wait", row(NOTE)], 30_000);

      ctx.log("Pin from the row menu lands pinned: true in the frontmatter");
      await agentBrowser(["click", `${row(NOTE)} button[aria-label="Actions for ${NOTE}"]`]);
      await agentBrowser(["find", "role", "menuitem", "click", "--name", "Pin", "--exact"]);
      const pinDeadline = Date.now() + DISK_DEADLINE_MS;
      for (;;) {
        const bytes = (await readOrNull(path.join(app.vaultDir, NOTE))) ?? "";
        if (bytes.includes("pinned: true")) {
          expect(bytes.endsWith(DOC), `the pin rewrote more than the frontmatter:\n${bytes}`);
          break;
        }
        expect(Date.now() < pinDeadline, `the pin never reached disk:\n${bytes}`);
        await delay(250);
      }

      ctx.log(`dragging ${NOTE} onto ${FOLDER}/ moves it`);
      await agentBrowser(["drag", row(NOTE), row(FOLDER)]);
      const moveDeadline = Date.now() + DISK_DEADLINE_MS;
      for (;;) {
        const moved = await readOrNull(path.join(app.vaultDir, FOLDER, NOTE));
        const original = await readOrNull(path.join(app.vaultDir, NOTE));
        if (moved !== null && original === null) {
          expect(moved.includes("pinned: true"), `the move dropped the frontmatter:\n${moved}`);
          break;
        }
        expect(
          Date.now() < moveDeadline,
          `the drop never moved the note: ${FOLDER}/${NOTE} ${moved === null ? "absent" : "present"}, ${NOTE} ${original === null ? "absent" : "present"}`,
        );
        await delay(250);
      }
    } finally {
      await closeQuietly(agentBrowser);
    }
  },
};
