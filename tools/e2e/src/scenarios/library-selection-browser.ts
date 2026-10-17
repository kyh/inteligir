import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TimelineConversationRow } from "@repo/contract/local/thread-timeline";
import { z } from "zod";
import { modChord, parseEval, untilBodyHolds } from "../harness/agent-browser";
import { expect, expectEq } from "../harness/assert";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { COMPOSER, clickCard, libraryCard } from "../harness/selectors";

const ALPHA = "Unsorted/Alpha.md";
const BETA = "Unsorted/Beta.md";
const MESSAGE = "which of these are about birds?";
const DEADLINE_MS = 30_000;

const SEED = {
  [ALPHA]: "---\nsaved: 2026-10-01T09:00:00Z\n---\n# Alpha\n\nAbout herons.\n",
  [BETA]: "---\nsaved: 2026-10-02T09:00:00Z\n---\n# Beta\n\nAbout bridges.\n",
} satisfies Readonly<Record<string, string>>;

// the page's own sends, as it puts them on the wire: what the composer handed the server
const RECORD_SENDS = `(() => {
  if (window.e2eSends === undefined) {
    window.e2eSends = [];
    const fetchBefore = window.fetch;
    window.fetch = (input, init) => {
      if (String(input instanceof Request ? input.url : input).includes("/threads/send")) {
        window.e2eSends.push(String(init?.body ?? ""));
      }
      return fetchBefore(input, init);
    };
  }
  return "recording";
})()`;
const SENDS = "JSON.stringify(window.e2eSends ?? [])";

const sentContextSchema = z.object({
  json: z.object({
    text: z.string(),
    viewContext: z.object({
      paths: z.array(z.string()),
      scope: z.object({ kind: z.string() }),
      selected: z.number(),
      surface: z.literal("library"),
    }),
  }),
});

export const librarySelectionBrowser: Scenario = {
  description:
    "two cards selected, ⌘K and send: the stored view context is the library surface with both paths",
  name: "library-selection-browser",
  async run(ctx) {
    const app = await ctx.boot({
      extraEnv: { INTELIGIR_AGENT: "scripted" },
      name: "solo",
      seedVault: async (vaultDir) => {
        await mkdir(path.join(vaultDir, "Unsorted"), { recursive: true });
        for (const [file, content] of Object.entries(SEED)) {
          await writeFile(path.join(vaultDir, file), content, "utf-8");
        }
      },
    });
    const browser = await ctx.browser("library-selection");
    await browser.openWorkspace(app);
    await browser(["wait", libraryCard(ALPHA)], DEADLINE_MS);
    await browser(["wait", libraryCard(BETA)], DEADLINE_MS);

    ctx.log("a click selects one card and a modified click adds the other");
    expectEq(parseEval(await browser(["eval", clickCard(ALPHA)]), z.string()), "clicked", ALPHA);
    expectEq(
      parseEval(await browser(["eval", clickCard(BETA, true)]), z.string()),
      "clicked",
      BETA,
    );
    await untilBodyHolds(browser, ["2 selected"]);

    ctx.log("⌘K names the selection in its one chip, and the send carries it");
    await browser(["eval", RECORD_SENDS]);
    await browser(["press", modChord("k")]);
    await browser(["wait", COMPOSER], DEADLINE_MS);
    await untilBodyHolds(browser, ["2 items"]);
    await browser(["fill", COMPOSER, MESSAGE]);
    await browser(["press", modChord("Enter")]);

    const sends = await pollUntil(
      async () => parseEval(await browser(["eval", SENDS]), z.array(z.string())),
      (bodies) => bodies.length > 0,
      { deadlineMs: DEADLINE_MS, describe: () => "the composer never sent" },
    );
    const sent = sentContextSchema.parse(JSON.parse(sends[0] ?? ""));
    expectEq(sent.json.text, MESSAGE, "the sent text");
    expectEq(sent.json.viewContext.selected, 2, "how many the send says are selected");
    expectEq(
      [...sent.json.viewContext.paths].toSorted(),
      [ALPHA, BETA],
      "the selected items the send names",
    );
    expectEq(sent.json.viewContext.scope.kind, "all", "the scope the grid showed");

    ctx.log("the thread records the screen it was sent from, not the selection's names");
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
    const recorded = user?.viewContext;
    expect(recorded?.surface === "library", "the thread recorded no library view");
    expectEq(recorded.selected, 2, "the recorded count");
    expectEq(recorded.paths, [], "the recorded names, which stay with the prompt");
  },
};
