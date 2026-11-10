import { expect, expectEq } from "../harness/assert";
import { signInPhone, signUp } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import type { CloudWorker } from "../harness/cloud-worker";
import { pollUntil } from "../harness/poll";
import { raindropCsv } from "../harness/raindrop-csv";
import type { Scenario, ScenarioContext } from "../harness/scenario";
import { asPhone, uploadFile, v1Client } from "../harness/v1-wire";

// every link sits in TEST-NET-1 (192.0.2.0/24), space the guarded fetch refuses before it opens a
// socket: each page's fill fails here and nothing leaves the machine. the import itself fetches
// nothing.
const LINK_HOST = "http://192.0.2.10";
const FILL_DEADLINE_MS = 60_000;

const BACKUP = raindropCsv([
  [
    "1",
    "File over app",
    "For Tuesday.",
    "Files you can control.",
    `${LINK_HOST}/file-over-app?utm_source=raindrop`,
    "Reading",
    "philosophy, files",
    "2023-07-01T09:12:30.000Z",
    `${LINK_HOST}/og.jpg`,
    "Highlight: Files last.\nNote: The point.\n\nHighlight: Apps are ephemeral.",
    "true",
  ],
  [
    "2",
    "Pasta al limone",
    "",
    "A quick lemon pasta.",
    `${LINK_HOST}/pasta`,
    "Cooking / Weeknight",
    "recipes, #Quick Meals",
    "1696147200",
    "",
    "",
    "false",
  ],
  ["3", "In the bin", "", "", `${LINK_HOST}/binned`, "Trash", "", "", "", "", ""],
  ["4", "Unsorted one", "", "", `${LINK_HOST}/unsorted`, "Unsorted", "", "", "", "", ""],
  [
    "5",
    "File over app (again)",
    "",
    "",
    `${LINK_HOST}/file-over-app`,
    "Reading",
    "ideas",
    "",
    "",
    "Highlight: A third one.",
    "",
  ],
]);
// the bookmark's note, then each highlight quoted with its own note under it, the duplicate's last
const QUOTED_NOTE = [
  "For Tuesday.",
  "> Files last.",
  "The point.",
  "> Apps are ephemeral.",
  "> A third one.",
].join("\n\n");

// a backup imported into the account's library over the one wire: the cell runs the job, every
// link lands unread in its collection's folder and the Worker's own fill consumer reads each,
// which the guarded fetch refuses here (an address written out), so each says so in the item
const importsIntoTheCloudLibrary = async (ctx: ScenarioContext, worker: CloudWorker) => {
  const phone = asPhone(await signInPhone(worker.origin));
  const { library } = v1Client(worker, phone);
  const upload = await uploadFile(worker, phone, {
    bytes: new TextEncoder().encode(BACKUP),
    type: "text/csv",
  });
  expectEq(upload.status, 201, "the backup's upload");

  ctx.log("the cloud imports the backup: three links, one folded into another, the bin left out");
  const started = await library.imports.start({ sha: upload.sha, source: "raindrop" });
  const done = await pollUntil(
    async () => await library.imports.get({ id: started.job.id }),
    (answer) => answer.job.state !== "running",
    { deadlineMs: FILL_DEADLINE_MS, describe: (answer) => `the import is ${answer.job.state}` },
  );
  expectEq(done.job.state, "done", "the cloud import's end");
  expectEq(done.job.added, 3, "links the cloud import added");
  expectEq(done.job.alreadySaved, 1, "rows folded into another of the same link");
  expectEq(done.job.skipped, 1, "rows left out");

  ctx.log("every link in its collection's folder, with its tags and its pin");
  const { folders, tags } = await library.organize.outline();
  const folderPath = (id: string | null): string => {
    const folder = folders.find((each) => each.id === id);
    return folder === undefined
      ? ""
      : [folderPath(folder.parentId), folder.name].filter(Boolean).join("/");
  };
  const { items: filed } = await library.items.list({ kind: "link" });
  expectEq(
    filed.map((item) => `${folderPath(item.folderId)}/${item.title}`).toSorted(),
    ["/Unsorted one", "Cooking/Weeknight/Pasta al limone", "Reading/File over app"],
    "the links by folder, the bin's left out and Unsorted's in no folder",
  );
  const fileOverApp = filed.find((item) => item.title === "File over app");
  expectEq(fileOverApp?.pinned, true, "the favourite is pinned");
  expectEq(fileOverApp?.url, `${LINK_HOST}/file-over-app`, "its url, its tracking left out");
  expectEq(
    fileOverApp?.tags.toSorted(),
    ["files", "ideas", "philosophy"],
    "the duplicate's tags folded in",
  );
  const listed = new Set(tags.map((entry) => entry.tag));
  for (const tag of ["Quick-Meals", "files", "ideas", "philosophy", "recipes"]) {
    expect(listed.has(tag), `the library's tags hold #${tag}: ${[...listed].join(", ")}`);
  }
  expect(fileOverApp !== undefined, "File over app was imported");
  const { view } = await library.items.read({ id: fileOverApp.id });
  expect(
    view.markdown.includes(QUOTED_NOTE),
    `its highlights quoted in its note, the duplicate's folded in:\n${view.markdown}`,
  );

  ctx.log("the Worker's fill consumer reads each link and says why it could not");
  const { items } = await library.items.list({ kind: "link" });
  expectEq(
    items
      .map((item) => item.title)
      .toSorted()
      .join(","),
    "File over app,Pasta al limone,Unsorted one",
    "the cloud library's links",
  );
  for (const item of items) {
    const read = await pollUntil(
      async () => await library.items.read({ id: item.id }),
      (answer) => answer.fields.fetchState !== "pending",
      {
        deadlineMs: FILL_DEADLINE_MS,
        describe: (answer) => `${item.title} is ${answer.fields.fetchState}`,
      },
    );
    expectEq(read.fields.fetchState, "failed", `${item.title}'s reading`);
    expectEq(
      read.fields.fetchError,
      "This address isn't one a page can be read from.",
      `${item.title}'s reading, said`,
    );
  }

  ctx.log("a second cloud import of the same backup, uploaded again, adds nothing");
  // the library let the first upload go once its import ended
  const reupload = await uploadFile(worker, phone, {
    bytes: new TextEncoder().encode(BACKUP),
    type: "text/csv",
  });
  expectEq(reupload.status, 201, "the backup's second upload");
  const again = await library.imports.start({ sha: reupload.sha, source: "raindrop" });
  const second = await pollUntil(
    async () => await library.imports.get({ id: again.job.id }),
    (answer) => answer.job.state !== "running",
    { deadlineMs: FILL_DEADLINE_MS, describe: (answer) => `the re-import is ${answer.job.state}` },
  );
  expectEq(second.job.added, 0, "links the cloud re-import added");
  expectEq(second.job.alreadySaved, 4, "rows the cloud re-import found saved");
};

export const raindropImport: Scenario = {
  description:
    "a Raindrop backup imported into the cloud library over the one wire puts its links in their collections' folders with their tags, pins and highlights quoted in their notes, a duplicate folded in and the bin left out; each lands unread and the Worker's fill consumer reads it, and a re-import adds nothing",
  name: "raindrop-import",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const worker = await ctx.cloudWorker();
    await signUp(worker.origin);
    await importsIntoTheCloudLibrary(ctx, worker);
  },
};
