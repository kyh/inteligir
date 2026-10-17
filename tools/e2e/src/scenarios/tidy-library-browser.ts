import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TimelineConversationRow } from "@repo/contract/local/thread-timeline";
import { clickButtonIn, clickStartingWith, untilBodyHolds } from "../harness/agent-browser";
import { expect, expectEq } from "../harness/assert";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { COMPOSER, LIBRARY_TITLE, libraryCard } from "../harness/selectors";

const UNSORTED_ITEM = "Unsorted/Heron.md";
const TIDY = "Tidy my library";
const COMPOSER_POPUP = '[role="dialog"][aria-label="Action composer"]';
const REPLY = 'textarea[aria-label="Reply to the agent"]';
const DEADLINE_MS = 30_000;

export const tidyLibraryBrowser: Scenario = {
  description:
    "the Unsorted header's Tidy, the preset chip and send: the panel opens on the thread",
  name: "tidy-library-browser",
  async run(ctx) {
    const app = await ctx.boot({
      extraEnv: { INTELIGIR_AGENT: "scripted" },
      name: "solo",
      seedVault: async (vaultDir) => {
        await mkdir(path.join(vaultDir, "Unsorted"), { recursive: true });
        await writeFile(
          path.join(vaultDir, UNSORTED_ITEM),
          "---\nsaved: 2026-10-01T09:00:00Z\n---\n# Heron\n\nA bird by the water.\n",
          "utf-8",
        );
      },
    });
    const browser = await ctx.browser("tidy-library");
    await browser.openWorkspace(app);

    ctx.log("Unsorted in the rail, then its header's Tidy my library");
    await clickStartingWith(browser, '[aria-label="Library"]', "Unsorted");
    await browser(["wait", libraryCard(UNSORTED_ITEM)], DEADLINE_MS);
    await pollUntil(
      async () => await browser(["get", "text", LIBRARY_TITLE]),
      (title) => title === "Unsorted",
      { deadlineMs: DEADLINE_MS, describe: (title) => `the header says "${title}"` },
    );
    await clickButtonIn(browser, "[data-library-view]", TIDY);

    ctx.log("⌘K opens on the preset's chip, and sends with nothing typed");
    await browser(["wait", COMPOSER], DEADLINE_MS);
    await untilBodyHolds(browser, [TIDY]);
    const placeholder = await browser(["get", "attr", COMPOSER, "placeholder"]);
    expectEq(placeholder, "Anything the rules don't say…", "the field beside the preset");
    await browser(["click", `${COMPOSER_POPUP} button[aria-label="Send"]`]);

    ctx.log("the panel opens on the new thread");
    await browser(["wait", REPLY], DEADLINE_MS);
    const user = await pollUntil(
      async () => {
        const { threads } = await app.api.threads.list({});
        const [thread] = threads;
        if (thread === undefined) {
          return null;
        }
        const body = await app.api.threads.timeline({ threadId: thread.id });
        return body.kind === "full"
          ? (body.timeline.rows.find(
              (row): row is TimelineConversationRow =>
                row.kind === "conversation" && row.role === "user",
            ) ?? null)
          : null;
      },
      (row) => row !== null,
      { deadlineMs: DEADLINE_MS, describe: () => "no user message on any thread" },
    );
    expectEq(user?.text, TIDY, "the stored text of a preset sent with nothing typed");
    const recorded = user?.viewContext;
    expect(recorded?.surface === "library", "the thread recorded no library view");
    expectEq(recorded.scope, { kind: "unsorted" }, "the scope Tidy works on");
    await untilBodyHolds(browser, ["Unsorted"]);
  },
};
