// a Raindrop import whose links are real pages, end to end across the lanes: the import (S3) makes
// each item a stub with its highlights waiting and hands it to the fill with the row's cover as a
// hint, the fill (S1) reads the page through the guarded fetch, and the highlights are placed by
// their quotes inside the article (S3) in the fill's own write. A link whose page is gone keeps its
// highlights under `## Highlights` and takes the CSV's cover. The pages are served on this
// machine's own network address, so a machine with none the guard reads from skips at the start.

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { annotationsResponseSchema } from "@repo/contract/local/annotations/annotations-schema";
import type { AnnotationsResponse } from "@repo/contract/local/annotations/annotations-schema";
import { importsJobResponseSchema } from "@repo/contract/local/imports/imports-schema";
import type { ItemRowWire } from "@repo/contract/local/items/items-schema";
import { knowledgeItemsResponseSchema } from "@repo/contract/local/knowledge/knowledge-schema";
import { agentShellCli } from "../harness/agent-shell-cli";
import type { AgentShellCli } from "../harness/agent-shell-cli";
import { expect, expectEq } from "../harness/assert";
import { startLanFixture } from "../harness/lan-fixture";
import type { LanRoute } from "../harness/lan-fixture";
import { solidPng } from "../harness/png-pixels";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";

const HEADER = "id,title,note,excerpt,url,folder,tags,created,cover,highlights,favorite";
const FILL_DEADLINE_MS = 90_000;

const LIVE_TITLE = "File over app";
const LIVE_ITEM = `Reading/${LIVE_TITLE}.md`;
const DEAD_TITLE = "A page that is gone";
const DEAD_ITEM = `Reading/${DEAD_TITLE}.md`;
const LIVE_NOTE = "For Tuesday.";

// the passages the export highlighted, each a sentence of the live page as it reads
const FIRST_QUOTE = "Files last.";
const SECOND_QUOTE = "Apps are ephemeral.";
const FIRST_NOTE = "The point.";
const DEAD_QUOTE = "Words the page no longer holds.";

// the article's structure is link-capture's, which the extractor keeps paragraph for paragraph
const LIVE_PAGE = [
  "<!doctype html>",
  '<html lang="en"><head><meta charset="utf-8">',
  `<title>${LIVE_TITLE}</title>`,
  '<meta property="og:site_name" content="Steph Ango">',
  "</head><body>",
  '<nav><a href="/">Home</a></nav>',
  "<article>",
  `<h1>${LIVE_TITLE}</h1>`,
  `<p>${FIRST_QUOTE} Apps do not, which is the whole case for keeping your notes as files you control.</p>`,
  "<h2>Why files</h2>",
  `<p>${SECOND_QUOTE} The files they write outlast every one of them, on your own disk.</p>`,
  "<p>A format any program can open is a format nobody can take away from you.</p>",
  "</article>",
  "<footer>Written on a quiet afternoon.</footer>",
  "</body></html>",
].join("\n");

// at least 200 px a side, or the fill skips it as no cover
const LIVE_COVER = solidPng(400, 300, [40, 90, 160, 255]);
const DEAD_COVER = solidPng(400, 300, [200, 120, 40, 255]);

const ROUTES = {
  "/covers/dead.png": { body: DEAD_COVER, type: "image/png" },
  "/covers/live.png": { body: LIVE_COVER, type: "image/png" },
  "/essays/file-over-app": { body: LIVE_PAGE },
} satisfies Record<string, LanRoute>;

// a CSV cell: quoted when it holds a comma, a quote or a line break, its quotes doubled
const cell = (value: string): string =>
  /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
const csvOf = (rows: readonly (readonly string[])[]): string =>
  `${[HEADER, ...rows.map((row) => row.map(cell).join(","))].join("\n")}\n`;

const backupOf = (url: (at: string) => string): string =>
  csvOf([
    [
      "1",
      LIVE_TITLE,
      LIVE_NOTE,
      "Files you can control.",
      url("/essays/file-over-app?utm_source=raindrop"),
      "Reading",
      "files",
      "2023-07-01T09:12:30.000Z",
      url("/covers/live.png"),
      `Highlight: ${FIRST_QUOTE}\nNote: ${FIRST_NOTE}\n\nHighlight: ${SECOND_QUOTE}`,
      "false",
    ],
    [
      "2",
      DEAD_TITLE,
      "",
      "",
      // nothing is served here: the fixture answers 404
      url("/essays/gone"),
      "Reading",
      "",
      "2023-07-02T09:12:30.000Z",
      url("/covers/dead.png"),
      `Highlight: ${DEAD_QUOTE}`,
      "false",
    ],
  ]);

const stdoutOf = async (cli: AgentShellCli, ...argv: string[]): Promise<string> => {
  const run = await cli(...argv);
  return run.stdout;
};

const itemsIn = async (cli: AgentShellCli): Promise<ItemRowWire[]> => {
  const { items } = knowledgeItemsResponseSchema.parse(
    JSON.parse(await stdoutOf(cli, "items", "--folder", "Reading", "--json")),
  );
  return items;
};

const annotationsOf = async (cli: AgentShellCli, item: string): Promise<AnnotationsResponse> =>
  annotationsResponseSchema.parse(
    JSON.parse(await stdoutOf(cli, "annotation", "list", item, "--json")),
  );

const markersAround = (id: string, quote: string): string =>
  `%%i:${id}:start%%${quote}%%i:${id}:end%%`;

const frontmatterOf = (content: string): string[] =>
  (/^---\n(?<yaml>[\s\S]*?)\n---\n/u.exec(content)?.groups?.["yaml"] ?? "").split("\n");

const bodyOf = (content: string): string => content.split("\n---\n").slice(1).join("\n---\n");

// the body's first block, when it is a cover embed: the path it names
const leadingCover = (content: string): string | null =>
  /^\n*!\[\]\((?<cover>assets\/covers\/[0-9a-f]{16}\.[a-z]+)\)\n/u.exec(bodyOf(content))?.groups?.[
    "cover"
  ] ?? null;

export const importIntegrated: Scenario = {
  description:
    "a Raindrop CSV of LAN-fixture pages imports, fills, and anchors its highlights in the article; a dead link's highlight sits under ## Highlights with the CSV's cover",
  name: "import-integrated",
  async run(ctx) {
    const lan = await startLanFixture(ROUTES);
    try {
      const app = await ctx.boot({ name: "solo" });
      const cli = agentShellCli(ctx.repoRoot, app.dataDir);
      const backup = path.join(ctx.scratchDir, "raindrop-backup.csv");
      await writeFile(backup, backupOf(lan.url), "utf-8");

      ctx.log("the import makes two stubs in their folder, each with its highlights waiting");
      const { job } = importsJobResponseSchema.parse(
        JSON.parse(await stdoutOf(cli, "import", "raindrop", backup, "--json")),
      );
      expectEq([job.state, job.added], ["done", 2], "the import's end and what it added");
      const waiting = await annotationsOf(cli, LIVE_ITEM);
      expectEq(
        waiting.annotations
          .map((entry) => entry.quote ?? "")
          .toSorted()
          .join("|"),
        [SECOND_QUOTE, FIRST_QUOTE].toSorted().join("|"),
        "the live link's highlights before its fill",
      );

      ctx.log("both pages fill: the live one read, the dead one with why");
      await pollUntil(
        async () => await itemsIn(cli),
        (items) => items.length === 2 && items.every((item) => !item.pending),
        {
          deadlineMs: FILL_DEADLINE_MS,
          describe: (items) =>
            `items still waiting for their fill: ${items
              .filter((item) => item.pending)
              .map((item) => item.path)
              .join(", ")}`,
        },
      );

      ctx.log("the live link's highlights are anchored inside the article's own text");
      const live = await readFile(path.join(app.vaultDir, LIVE_ITEM), "utf-8");
      const liveKeys = frontmatterOf(live);
      expect(
        liveKeys.some((line) => /^fetched: \S+$/u.test(line)) &&
          !liveKeys.some((line) => line.startsWith("fetch-error:")),
        `the live page was read:\n${live}`,
      );
      expect(liveKeys.includes("site: Steph Ango"), `the live item names its site:\n${live}`);
      expect(
        live.includes("A format any program can open is a format nobody can take away from you."),
        `the article's text is in the item:\n${live}`,
      );
      expect(
        bodyOf(live).indexOf(LIVE_NOTE) < bodyOf(live).indexOf("A format any program can open"),
        `the export's note sits above the article:\n${live}`,
      );
      expect(!live.includes("\n## Highlights\n"), `nothing waits under ## Highlights:\n${live}`);
      const placed = await annotationsOf(cli, LIVE_ITEM);
      expectEq(
        placed.annotations.map((entry) => entry.state),
        ["anchored", "anchored"],
        "the live link's highlights after its fill",
      );
      // the fold lists the anchored in the order their markers open: the article's order
      expectEq(
        placed.annotations.map((entry) => entry.quote),
        [FIRST_QUOTE, SECOND_QUOTE],
        "the highlights in the article's order",
      );
      for (const entry of placed.annotations) {
        expect(
          live.includes(markersAround(entry.id, entry.quote ?? "")),
          `the markers wrap "${entry.quote ?? ""}" in the article:\n${live}`,
        );
        expectEq(entry.passage, entry.quote, `the live text between ${entry.id}'s markers`);
      }
      expectEq(
        placed.annotations.find((entry) => entry.quote === FIRST_QUOTE)?.root.text,
        FIRST_NOTE,
        "the export's note on its highlight",
      );

      ctx.log(
        "the dead link says why, keeps its highlight under ## Highlights, and the CSV's cover",
      );
      const dead = await readFile(path.join(app.vaultDir, DEAD_ITEM), "utf-8");
      expect(
        frontmatterOf(dead).includes("fetch-error: The site answered 404 (not found)."),
        `the dead link says why:\n${dead}`,
      );
      const deadHighlights = await annotationsOf(cli, DEAD_ITEM);
      const [highlight] = deadHighlights.annotations;
      expectEq(highlight?.state, "anchored", "the dead link's highlight, placed for good");
      const heading = dead.indexOf("\n## Highlights\n");
      expect(heading !== -1, `the dead link's highlight sits under its heading:\n${dead}`);
      expect(
        dead.indexOf(markersAround(highlight?.id ?? "", DEAD_QUOTE)) > heading,
        `the markers wrap the quote under ## Highlights:\n${dead}`,
      );
      const cover = leadingCover(dead);
      expect(cover !== null, `the dead link's body opens on a cover:\n${dead}`);
      expect(existsSync(path.join(app.vaultDir, cover)), `${cover} is on disk`);
      const asked = lan.requests().map((seen) => seen.path);
      expect(
        asked.includes("/essays/gone") && asked.includes("/covers/dead.png"),
        `the fill read the dead page and then the CSV's cover for it: ${asked.join(", ")}`,
      );
    } finally {
      await lan.close();
    }
  },
  timeoutMs: 240_000,
};
