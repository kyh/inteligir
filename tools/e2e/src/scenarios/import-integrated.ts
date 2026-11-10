// a Raindrop import whose links are real pages, end to end in the cloud: the account's cell runs
// the import, which makes each item an unread link, its highlights quoted in its note, and hands it
// to the Worker's fill with the row's cover as a hint; the fill reads the page under its public
// name (`../harness/page-fixture.ts`) into the article below the note, and a page that names no
// picture takes the CSV's. A link whose page is gone says why and keeps its quoted note.

import { expect, expectEq } from "../harness/assert";
import { signInPhone, signUp } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { startPageFixture } from "../harness/page-fixture";
import type { PageRoute } from "../harness/page-fixture";
import { solidPng } from "../harness/png-pixels";
import { pollUntil } from "../harness/poll";
import { raindropCsv } from "../harness/raindrop-csv";
import type { Scenario } from "../harness/scenario";
import { asPhone, itemFieldsOf, readFile, uploadFile, v1Client } from "../harness/v1-wire";

const FILL_DEADLINE_MS = 90_000;

const LIVE_TITLE = "File over app";
const DEAD_TITLE = "A page that is gone";
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
} satisfies Record<string, PageRoute>;

const backupOf = (url: (at: string) => string): string =>
  raindropCsv([
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

export const importIntegrated: Scenario = {
  description:
    "a Raindrop CSV of pages imported into the cloud library fills through the Worker, the export's note and its quoted highlights kept above the article and the CSV's cover taken where the page names none; a dead link says why and keeps its quoted highlight",
  name: "import-integrated",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const pages = await startPageFixture(ROUTES);
    try {
      const worker = await ctx.cloudWorker({ pages: pages.pages });
      await signUp(worker.origin);
      const phone = asPhone(await signInPhone(worker.origin));
      const { library } = v1Client(worker, phone);
      const upload = await uploadFile(worker, phone, {
        bytes: new TextEncoder().encode(backupOf(pages.publicUrl)),
        type: "text/csv",
      });
      expectEq(upload.status, 201, "the backup's upload");

      ctx.log("the cloud imports two links into their folder, each with its highlights quoted");
      const started = await library.imports.start({ sha: upload.sha, source: "raindrop" });
      const done = await pollUntil(
        async () => await library.imports.get({ id: started.job.id }),
        (answer) => answer.job.state !== "running",
        { deadlineMs: FILL_DEADLINE_MS, describe: (answer) => `the import is ${answer.job.state}` },
      );
      expectEq([done.job.state, done.job.added], ["done", 2], "the import's end and what it added");
      const { items } = await library.items.list({ kind: "link" });
      const live = items.find((item) => item.title === LIVE_TITLE);
      const dead = items.find((item) => item.title === DEAD_TITLE);
      expect(
        live !== undefined && dead !== undefined,
        `the import's links: ${items.map((item) => item.title).join(", ")}`,
      );

      ctx.log("both pages fill: the live one read, the dead one with why");
      const settled = async (id: string, label: string) =>
        await pollUntil(
          async () => await library.items.read({ id }),
          (read) => read.fields.fetchState !== "pending",
          {
            deadlineMs: FILL_DEADLINE_MS,
            describe: (read) => `${label} is ${read.fields.fetchState}`,
          },
        );
      const liveRead = await settled(live.id, "the live link");
      expectEq(
        [liveRead.fields.fetchState, liveRead.fields.fetchError, liveRead.fields.site],
        ["filled", null, "Steph Ango"],
        "the live page, read",
      );
      const { markdown } = liveRead.view;
      const articleAt = markdown.indexOf(
        "A format any program can open is a format nobody can take away from you.",
      );
      expect(articleAt !== -1, `the article's text is in the item:\n${markdown}`);
      const noteAt = markdown.indexOf(
        [LIVE_NOTE, `> ${FIRST_QUOTE}`, FIRST_NOTE, `> ${SECOND_QUOTE}`].join("\n\n"),
      );
      expect(
        noteAt !== -1 && noteAt < articleAt,
        `the export's note and its quoted highlights are kept, above the article:\n${markdown}`,
      );

      ctx.log("the page names no picture, so the live link takes the CSV's cover");
      const liveFields = await itemFieldsOf(library, live.id);
      const coverSha = liveFields?.coverSha ?? null;
      expect(coverSha !== null, "the live link holds a cover");
      const cover = await readFile(worker, phone, coverSha);
      expectEq(
        Buffer.compare(Buffer.from(await cover.arrayBuffer()), Buffer.from(LIVE_COVER)),
        0,
        "the live link's cover is the CSV's",
      );

      ctx.log("the dead link says why and keeps its quoted highlight");
      const deadRead = await settled(dead.id, "the dead link");
      expectEq(
        [deadRead.fields.fetchState, deadRead.fields.fetchError],
        ["failed", "The site answered 404 (not found)."],
        "the dead link's reading",
      );
      expect(
        deadRead.view.markdown.includes(`> ${DEAD_QUOTE}`),
        `the dead link's highlight is quoted in its note:\n${deadRead.view.markdown}`,
      );
      const asked = pages.requests();
      expect(
        asked.includes("/essays/gone") && !asked.includes("/covers/dead.png"),
        `the fill asked for the dead page, and for no cover of a page it could not read: ${asked.join(", ")}`,
      );
    } finally {
      await pages.close();
    }
  },
};
