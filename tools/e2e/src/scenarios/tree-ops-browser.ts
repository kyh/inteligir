import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { agentBrowserSession, probeHeadlessOrSkip } from "../harness/agent-browser";
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

function row(path: string): string {
  return `[role="tree"] [data-path="${path}"]`;
}

async function readOrNull(path: string): Promise<string | null> {
  return readFile(path, "utf8").catch(() => null);
}

export const treeOpsBrowser: Scenario = {
  name: "tree-ops-browser",
  description: "the tree's row menu pins a note into its frontmatter, and a drag moves it",
  async run(ctx) {
    const app = await ctx.boot({
      name: "solo",
      seedVault: async (vaultDir) => {
        await writeFile(join(vaultDir, NOTE), DOC, "utf8");
        await mkdir(join(vaultDir, FOLDER), { recursive: true });
        await writeFile(join(vaultDir, FOLDER, FOLDER_NOTE), "# Zebra\n", "utf8");
      },
    });
    try {
      await probeHeadlessOrSkip(agentBrowser, ctx.log);

      ctx.log(`opening ${app.baseUrl}/`);
      await agentBrowser(["open", `${app.baseUrl}/`], 60_000);
      await agentBrowser(["wait", EDITOR], 90_000);

      ctx.log("switching the rail to the tree");
      await agentBrowser(["find", "role", "tab", "click", "--name", "Files", "--exact"]);
      await agentBrowser(["wait", row(NOTE)], 30_000);

      ctx.log("Pin from the row menu lands pinned: true in the frontmatter");
      await agentBrowser(["click", `${row(NOTE)} button[aria-label="Actions for ${NOTE}"]`]);
      await agentBrowser(["find", "role", "menuitem", "click", "--name", "Pin", "--exact"]);
      const pinDeadline = Date.now() + DISK_DEADLINE_MS;
      for (;;) {
        const bytes = (await readOrNull(join(app.vaultDir, NOTE))) ?? "";
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
        const moved = await readOrNull(join(app.vaultDir, FOLDER, NOTE));
        const original = await readOrNull(join(app.vaultDir, NOTE));
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
      await agentBrowser(["close"], 30_000).catch(() => undefined);
    }
  },
};
