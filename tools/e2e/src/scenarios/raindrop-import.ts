import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { annotationsResponseSchema } from "@repo/contract/local/annotations/annotations-schema";
import type { AnnotationsResponse } from "@repo/contract/local/annotations/annotations-schema";
import {
  importsJobResponseSchema,
  importsPlanResponseSchema,
} from "@repo/contract/local/imports/imports-schema";
import type { ImportJob } from "@repo/contract/local/imports/imports-schema";
import type { ItemRowWire } from "@repo/contract/local/items/items-schema";
import {
  knowledgeItemsResponseSchema,
  knowledgeTagsResponseSchema,
} from "@repo/contract/local/knowledge/knowledge-schema";
import { writeDeviceCredential } from "inteligir/server/cloud/credential-store";
import { agentShellCli } from "../harness/agent-shell-cli";
import type { AgentShellCli } from "../harness/agent-shell-cli";
import { expect, expectEq } from "../harness/assert";
import { loginDevice, OWNER, signUp } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { gitIn } from "../harness/exec";
import { hostedVaultEnv, signInOwner, syncUntil } from "../harness/hosted-vault";
import type { AppInstance } from "../harness/instance";
import { pollUntil } from "../harness/poll";
import type { Scenario, ScenarioContext } from "../harness/scenario";
import { uploadFile, v1Client } from "../harness/v1-wire";
import type { CloudWorker } from "../harness/cloud-worker";

// every link sits in TEST-NET-1 (192.0.2.0/24), space the guarded fetch refuses before it opens a
// socket: each page's fill fails here and nothing leaves the machine (§0.2.9). the import itself
// fetches nothing.
const LINK_HOST = "http://192.0.2.10";
const HEADER = "id,title,note,excerpt,url,folder,tags,created,cover,highlights,favorite";
const IMPORT_MESSAGE = "Import from Raindrop";
const FILL_DEADLINE_MS = 60_000;

// a CSV cell: quoted when it holds a comma, a quote or a line break, its quotes doubled
const cell = (value: string): string =>
  /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
const csvOf = (rows: readonly (readonly string[])[]): string =>
  `${[HEADER, ...rows.map((row) => row.map(cell).join(","))].join("\n")}\n`;

const BACKUP = csvOf([
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
const FILE_OVER_APP = "Reading/File over app.md";
const QUOTES = ["A third one.", "Apps are ephemeral.", "Files last."];

// three batches of at most a hundred, for the hosted leg
const BULK_ROWS = 201;
const bulkBackup = (): string =>
  csvOf(
    Array.from({ length: BULK_ROWS }, (_, index) => [
      String(index + 1),
      `Bulk link ${String(index + 1).padStart(3, "0")}`,
      "",
      "",
      `${LINK_HOST}/bulk/${index + 1}`,
      "Bulk",
      "bulk",
      "",
      "",
      "",
      "",
    ]),
  );

const stdoutOf = async (cli: AgentShellCli, ...argv: string[]): Promise<string> => {
  const run = await cli(...argv);
  return run.stdout;
};

const importJob = async (cli: AgentShellCli, file: string): Promise<ImportJob> => {
  const { job } = importsJobResponseSchema.parse(
    JSON.parse(await stdoutOf(cli, "import", "raindrop", file, "--json")),
  );
  return job;
};

const itemsIn = async (cli: AgentShellCli, ...argv: string[]): Promise<ItemRowWire[]> => {
  const { items } = knowledgeItemsResponseSchema.parse(
    JSON.parse(await stdoutOf(cli, "items", ...argv, "--limit", "500", "--json")),
  );
  return items;
};

const annotationsOf = async (cli: AgentShellCli, item: string): Promise<AnnotationsResponse> =>
  annotationsResponseSchema.parse(
    JSON.parse(await stdoutOf(cli, "annotation", "list", item, "--json")),
  );

const importCommits = async (vaultDir: string): Promise<number> => {
  const log = await gitIn(vaultDir, ["log", "--format=%s"]);
  return log.split("\n").filter((subject) => subject === IMPORT_MESSAGE).length;
};

// a stub's fill is refused here, which still lands: its fetch-error, and its waiting highlights
// placed under the text
const untilFilled = async (cli: AgentShellCli, ...argv: string[]): Promise<ItemRowWire[]> =>
  await pollUntil(
    async () => await itemsIn(cli, ...argv),
    (items) => items.length > 0 && items.every((item) => !item.pending),
    {
      deadlineMs: FILL_DEADLINE_MS,
      describe: (items) =>
        `${items.filter((item) => item.pending).length} of ${items.length} items still waiting for their fill`,
    },
  );

const importsIntoFolders = async (
  ctx: ScenarioContext,
  app: AppInstance,
  cli: AgentShellCli,
): Promise<void> => {
  const backup = path.join(ctx.scratchDir, "raindrop-backup.csv");
  await writeFile(backup, BACKUP, "utf-8");
  // the starter library's own links, which every link listing below also holds
  const starterLinks = await itemsIn(cli, "--kind", "link");
  const starters = new Set(starterLinks.map((item) => item.path));
  const imported = (items: readonly ItemRowWire[]): ItemRowWire[] =>
    items.filter((item) => !starters.has(item.path));

  ctx.log("the plan: three links, one folded into another, and the bin left out");
  const plan = importsPlanResponseSchema.parse(
    JSON.parse(await stdoutOf(cli, "import", "raindrop", backup, "--dry-run", "--json")),
  );
  expectEq(plan.items, 3, "links the plan imports");
  expectEq(plan.duplicates, 1, "rows folded into another of the same link");
  expectEq(plan.skippedCount, 1, "rows left out");
  expectEq(plan.highlights, 3, "highlights");

  ctx.log("the import: folders, tags and pins, in one commit");
  const job = await importJob(cli, backup);
  expectEq(job.state, "done", "the job's end");
  expectEq(job.added, 3, "items added");
  const items = imported(await itemsIn(cli, "--kind", "link"));
  expectEq(
    items
      .map((item) => item.path)
      .toSorted()
      .join(","),
    ["Cooking/Weeknight/Pasta al limone.md", FILE_OVER_APP, "Unsorted/Unsorted one.md"].join(","),
    "every link in its collection's folder, the bin's left out",
  );
  const fileOverApp = items.find((item) => item.path === FILE_OVER_APP);
  expectEq(fileOverApp?.pinned, true, "the favourite is pinned");
  expectEq(fileOverApp?.url, `${LINK_HOST}/file-over-app`, "its url, its tracking left out");
  expectEq(
    fileOverApp?.tags.toSorted().join(","),
    "files,ideas,philosophy",
    "the duplicate's tags folded in",
  );
  const { tags } = knowledgeTagsResponseSchema.parse(
    JSON.parse(await stdoutOf(cli, "tags", "--json")),
  );
  // beside the starter notes' own tags
  const listed = new Set(tags.map((entry) => entry.tag));
  for (const tag of ["Quick-Meals", "files", "ideas", "philosophy", "recipes"]) {
    expect(listed.has(tag), `the library's tags hold #${tag}: ${[...listed].join(", ")}`);
  }
  expectEq(await importCommits(app.vaultDir), 1, "commits the import made");

  ctx.log("its highlights wait on the stub, then the fill places them under its text");
  const waiting = await annotationsOf(cli, FILE_OVER_APP);
  expectEq(
    waiting.annotations
      .map((entry) => entry.quote ?? "")
      .toSorted()
      .join("|"),
    QUOTES.join("|"),
    "the highlights' quotes",
  );
  expectEq(
    waiting.annotations.find((entry) => entry.quote === "Files last.")?.root.text,
    "The point.",
    "a highlight's note",
  );
  expect(
    waiting.annotations.every((entry) => entry.state !== "missing"),
    "no highlight is lost while its page fills",
  );
  await untilFilled(cli, "--kind", "link");
  const placed = await annotationsOf(cli, FILE_OVER_APP);
  expectEq(
    placed.annotations.map((entry) => entry.state).join(","),
    "anchored,anchored,anchored",
    "the highlights once the fill landed",
  );
  const body = await readFile(path.join(app.vaultDir, FILE_OVER_APP), "utf-8");
  expect(body.includes("\n## Highlights\n"), `the highlights sit under their heading:\n${body}`);
  for (const entry of placed.annotations) {
    expect(
      body.includes(`%%i:${entry.id}:start%%${entry.quote ?? ""}%%i:${entry.id}:end%%`),
      `the markers wrap "${entry.quote ?? ""}"`,
    );
  }

  ctx.log("a second import of the same backup adds nothing");
  const again = await importJob(cli, backup);
  expectEq(again.added, 0, "items the re-import added");
  expectEq(again.alreadySaved, 3, "items it found saved");
  const after = imported(await itemsIn(cli, "--kind", "link"));
  expectEq(after.length, 3, "items after the re-import");
  expectEq(await importCommits(app.vaultDir), 1, "commits after the re-import");
};

const reachesTheHostedLibraryInBatches = async (
  ctx: ScenarioContext,
  worker: CloudWorker,
): Promise<void> => {
  const a = await ctx.boot({ extraEnv: hostedVaultEnv(worker.origin), name: "a" });
  await signInOwner(a, "A", "E2E Device A");
  const cli = agentShellCli(ctx.repoRoot, a.dataDir);
  const backup = path.join(ctx.scratchDir, "raindrop-bulk.csv");
  await writeFile(backup, bulkBackup(), "utf-8");

  ctx.log(`A imports ${BULK_ROWS} links: one commit per hundred`);
  const job = await importJob(cli, backup);
  expectEq(job.added, BULK_ROWS, "items added");
  expectEq(await importCommits(a.vaultDir), 3, "commits the import made");
  await untilFilled(cli, "--folder", "Bulk");
  await syncUntil(a.api, "A after the import", "clean");
  const aHead = await gitIn(a.vaultDir, ["rev-parse", "HEAD"]);

  ctx.log("B signs in and clones the import's three commits");
  const deviceB = await loginDevice(worker.origin, "E2E Device B");
  const b = await ctx.boot({
    extraEnv: hostedVaultEnv(worker.origin),
    name: "b",
    seedData: (dataDir) => {
      writeDeviceCredential(dataDir, { ...deviceB, deviceName: "E2E Device B" });
    },
  });
  expectEq(await gitIn(b.vaultDir, ["rev-parse", "HEAD"]), aHead, "B's HEAD");
  expectEq(await importCommits(b.vaultDir), 3, "the import's commits on B");
  const listed = await gitIn(b.vaultDir, ["ls-files", "Bulk"]);
  expectEq(listed.split("\n").length, BULK_ROWS, "B holds every imported item");
};

// the same backup imported into the account's library in the cloud, over the one wire: the cell
// runs the job, every link lands unread and the Worker's own fill consumer reads each, which the
// guarded fetch refuses here (an address written out), so each says so in the item
const importsIntoTheCloudLibrary = async (ctx: ScenarioContext, worker: CloudWorker) => {
  const phone = await v1Client(worker, null).account.signIn({ ...OWNER, deviceName: "E2E Phone" });
  const { library } = v1Client(worker, phone.credential);
  const upload = await uploadFile(worker, phone.credential, {
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
  expectEq(done.job.highlights, 3, "highlights the cloud import kept");

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
      "This address is on a private network, which the cloud can't reach, so its page isn't read.",
      `${item.title}'s reading, said`,
    );
  }

  ctx.log("a second cloud import of the same backup, uploaded again, adds nothing");
  // the library let the first upload go once its import ended
  const reupload = await uploadFile(worker, phone.credential, {
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
    "import raindrop puts a backup's links in their folders with their tags and pins, its highlights wait on their stubs, a re-import adds nothing, and the hosted library takes it in batches; the same backup imported into the cloud library over the one wire lands as unread links the Worker's fill consumer reads, and a re-import there adds nothing too",
  name: "raindrop-import",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const app = await ctx.boot({ name: "solo" });
    const cli = agentShellCli(ctx.repoRoot, app.dataDir);
    await importsIntoFolders(ctx, app, cli);
    const status = await stdoutOf(cli, "import", "status");
    expectEq(
      status.trim(),
      "Imported 0 items from Raindrop (3 already saved)",
      "the latest import's status",
    );
    const worker = await ctx.cloudWorker();
    await signUp(worker.origin);
    await reachesTheHostedLibraryInBatches(ctx, worker);
    await importsIntoTheCloudLibrary(ctx, worker);
  },
};
