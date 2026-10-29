import { randomBytes } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  itemSaveResponseSchema,
  itemTagResultSchema,
} from "@repo/contract/local/items/items-schema";
import type { ItemRowWire } from "@repo/contract/local/items/items-schema";
import { knowledgeItemsResponseSchema } from "@repo/contract/local/knowledge/knowledge-schema";
import { agentShellCli } from "../harness/agent-shell-cli";
import type { AgentShellCli } from "../harness/agent-shell-cli";
import { expect, expectEq } from "../harness/assert";
import { readOrNull } from "../harness/exec";
import type { AppInstance } from "../harness/instance";
import { pollUntil } from "../harness/poll";
import type { Scenario, ScenarioContext } from "../harness/scenario";

const NOTE_PATH = "notes/cli-drive.md";
const NOTE_TOKEN = "clidrivetoken";
const NOTE_CONTENT = `# CLI drive\n\nA note carrying ${NOTE_TOKEN} for search.\n`;
const PROMPT = "Hello from cli-drive";
const SEARCH_DEADLINE_MS = 30_000;

// loose: only the fields asserted on, so an addition upstream does not fail the run.
const searchOutputSchema = z.looseObject({ results: z.array(z.unknown()) });
const searchHitSchema = z.looseObject({ path: z.string() });
const threadOutputSchema = z.looseObject({ thread: z.looseObject({ id: z.string() }) });
const turnChangesOutputSchema = z.looseObject({
  turns: z.array(z.looseObject({ paths: z.array(z.string()), state: z.string() })),
});
const undoOutputSchema = z.looseObject({ reverted: z.array(z.string()) });
const newIdOutputSchema = z.looseObject({ annotations: z.literal("copied"), id: z.string() });

const SHARED_NOTE = "notes/shared.md";
const SHARED_COPY = "notes/shared copy.md";
const SHARED_ID = "0f6a3b1e-5c2d-4e8f-9a7b-1c3d5e7f9a0b";
const SHARED_CONTENT = `---\ntitle: Shared\nid: ${SHARED_ID}\n---\n# Shared\n`;
const SHARED_STORE = `${JSON.stringify(
  {
    first: { createdAt: 1, quote: "Shared", source: "user", text: "The first note", updatedAt: 1 },
    second: {
      createdAt: 2,
      quote: "Shared",
      source: "user",
      text: "The second note",
      updatedAt: 2,
    },
  },
  null,
  2,
)}\n`;

// in TEST-NET-1, which the guarded fetch refuses before it opens a socket: the link saves, its
// fill fails, and nothing leaves the machine (§0.2.9)
const LINK = "http://192.0.2.10/reading-list";
const PAPER = "Paper.pdf";

const pathsOf = async (cli: AgentShellCli, ...argv: string[]): Promise<string[]> => {
  const { stdout } = await cli("items", ...argv, "--limit", "500", "--json");
  const { items } = knowledgeItemsResponseSchema.parse(JSON.parse(stdout));
  return items.map((item: ItemRowWire) => item.path).toSorted();
};

const stdoutOf = async (cli: AgentShellCli, ...argv: string[]): Promise<string> => {
  const run = await cli(...argv);
  return run.stdout.trim();
};

// a PDF and a link saved into Unsorted, listed by kind, by folder and untagged, found by its url
// however it is spelled, and tagged and untagged
const drivesTheLibrary = async (
  ctx: ScenarioContext,
  app: AppInstance,
  cli: AgentShellCli,
): Promise<void> => {
  const sources = path.join(ctx.scratchDir, "sources");
  await mkdir(sources, { recursive: true });
  // the starter library's own items, which every listing below also holds
  const starters = new Set(await pathsOf(cli));
  const saved = (paths: readonly string[]): string[] => paths.filter((p) => !starters.has(p));
  const pdfFile = path.join(sources, PAPER);
  await writeFile(pdfFile, Buffer.concat([Buffer.from("%PDF-1.4\n"), randomBytes(2048)]));
  const paper = itemSaveResponseSchema.parse(
    JSON.parse(await stdoutOf(cli, "save", pdfFile, "--json")),
  );
  expectEq(paper.path, "Unsorted/Paper.md", "the PDF's item");
  const link = itemSaveResponseSchema.parse(
    JSON.parse(await stdoutOf(cli, "save", `${LINK}?utm_source=cli-drive`, "--json")),
  );
  expectEq(link.fill.state, "failed", "the refused link's fill");
  expect(link.path.startsWith("Unsorted/"), `the link lands in Unsorted: ${link.path}`);

  const pdfs = saved(await pathsOf(cli, "--kind", "pdf"));
  expectEq(pdfs.join(","), paper.path, "items --kind pdf");
  const unsorted = saved(await pathsOf(cli, "--folder", "Unsorted"));
  expectEq(
    unsorted.join(","),
    [link.path, paper.path].toSorted().join(","),
    "items --folder Unsorted",
  );
  const untagged = await pathsOf(cli, "--untagged");
  expect(
    untagged.includes(paper.path) && untagged.includes(link.path),
    `items --untagged lists both: ${untagged.join(", ")}`,
  );

  ctx.log("item find matches the link however it is spelled");
  expectEq(await stdoutOf(cli, "item", "find", LINK), link.path, "item find on the bare link");
  expectEq(
    await stdoutOf(cli, "item", "find", `${LINK}?utm_medium=email#top`),
    link.path,
    "item find past tracking and a fragment",
  );
  const unsaved = await stdoutOf(cli, "item", "find", "http://192.0.2.10/never-saved");
  expect(unsaved.includes("Not saved yet"), `item find on a link never saved: ${unsaved}`);

  ctx.log("tag add and remove, in the frontmatter, and the listing follows");
  expectEq(
    await stdoutOf(cli, "tag", "add", "reading", paper.path),
    `Tagged ${paper.path} #reading`,
    "tag add",
  );
  const again = itemTagResultSchema.parse(
    JSON.parse(await stdoutOf(cli, "tag", "add", "reading", paper.path, "--json")),
  );
  expectEq(again.outcome, "unchanged", "a second tag add");
  const tagged = await readFile(path.join(app.vaultDir, paper.path), "utf-8");
  expect(/^tags:\n {2}- reading$/mu.test(tagged), `the tag is in the frontmatter:\n${tagged}`);
  const readingList = saved(await pathsOf(cli, "--tag", "reading"));
  expectEq(readingList.join(","), paper.path, "items --tag");
  const stillUntagged = await pathsOf(cli, "--untagged");
  expect(!stillUntagged.includes(paper.path), "no longer untagged");
  expectEq(
    await stdoutOf(cli, "tag", "remove", "reading", paper.path),
    `Removed #reading from ${paper.path}`,
    "tag remove",
  );
  const untaggedAgain = await pathsOf(cli, "--untagged");
  expect(untaggedAgain.includes(paper.path), "untagged again");
};

export const cliDrive: Scenario = {
  description:
    "the CLI drives a real instance, and the env an agent's shell would get resolves against this checkout: vault write and read, search, action new, wait, show, changes and undo, and status; `vault new-id` gives a byte copy that shares its original's id one of its own on the same line, with a copy of the store; a saved PDF and link list by kind, folder and untagged, `item find` matches the link however it is spelled, and `tag add` and `tag remove` change the item",
  name: "cli-drive",
  // bin/inteligir runs src/ under tsx in a checkout; the bundle is built-cli-boot's to test, and
  // the packed tarball pnpm smoke:cli's.
  async run(ctx) {
    const app = await ctx.boot({
      extraEnv: { INTELIGIR_AGENT: "scripted" },
      name: "solo",
    });

    const cli = agentShellCli(ctx.repoRoot, app.dataDir);

    ctx.log("the bare command resolves through the agent's PATH");
    const which = await cli("--version");
    expect(which.stdout.trim().length > 0, "`inteligir --version` answered");

    ctx.log("vault write + read through the CLI, verified on disk");
    await cli("vault", "write", NOTE_PATH, "--content", NOTE_CONTENT, "--if-absent");
    const readBack = await cli("vault", "read", NOTE_PATH);
    expectEq(readBack.stdout, NOTE_CONTENT, "CLI read-back matches");
    expectEq(
      await readFile(path.join(app.vaultDir, NOTE_PATH), "utf-8"),
      NOTE_CONTENT,
      "written bytes on disk",
    );
    const listing = await cli("vault", "list", "notes");
    expect(listing.stdout.includes(NOTE_PATH), "the listing names the note");

    ctx.log("search finds the note (projection is async — poll)");
    const results = await pollUntil(
      async () => {
        const search = await cli("search", NOTE_TOKEN, "--json");
        const parsed = searchOutputSchema.safeParse(JSON.parse(search.stdout));
        return parsed.success ? parsed.data.results : [];
      },
      (found) => found.length > 0,
      {
        deadlineMs: SEARCH_DEADLINE_MS,
        describe: () => `search still empty after ${SEARCH_DEADLINE_MS}ms`,
      },
    );
    expect(
      results.some((result) => searchHitSchema.safeParse(result).data?.path === NOTE_PATH),
      "search names the written note",
    );

    ctx.log("action new + wait under the scripted driver");
    const created = await cli("action", "new", PROMPT, "--json");
    const createdParsed = threadOutputSchema.safeParse(JSON.parse(created.stdout));
    const threadId = createdParsed.data?.thread.id;
    expect(threadId !== undefined, "action new --json names the thread id");
    if (threadId === undefined) {
      return;
    }
    // exec throws on a non-zero exit, so a clean return is the exit-0 assert.
    const waited = await cli("action", "wait", threadId, "--timeout", "60");
    expect(waited.stdout.includes("is idle"), "wait reports the idle settle");

    ctx.log("show renders the timeline");
    const shown = await cli("action", "show", threadId);
    expect(shown.stdout.includes(`Thread ${threadId} — idle`), "show names the settled thread");
    expect(shown.stdout.includes("── user ──"), "the user turn is rendered");
    expect(shown.stdout.includes(`Noted: ${PROMPT}`), "the scripted agent's reply is rendered");
    expect(
      shown.stdout.includes(`~ add Agent/${threadId}.md`),
      "the scripted driver's file change is rendered",
    );

    ctx.log("changes names what the turn committed");
    const changes = await cli("action", "changes", threadId, "--json");
    const changed = turnChangesOutputSchema.safeParse(JSON.parse(changes.stdout));
    expectEq(
      changed.data?.turns.map((turn) => `${turn.state} ${turn.paths.join(",")}`).join("\n"),
      `applied Agent/${threadId}.md`,
      "the one turn, applied, and the note it wrote",
    );

    ctx.log("undo takes the turn back");
    const undone = await cli("action", "undo", threadId, "--json");
    const undoneParsed = undoOutputSchema.safeParse(JSON.parse(undone.stdout));
    expectEq(
      undoneParsed.data?.reverted.join(","),
      `Agent/${threadId}.md`,
      "the undo reverted the note the turn made",
    );
    expectEq(
      await readOrNull(path.join(app.vaultDir, "Agent", `${threadId}.md`)),
      null,
      "the note the untouched turn made is gone from disk",
    );

    ctx.log("a byte copy shares its original's id until vault new-id gives it one of its own");
    await cli("vault", "write", SHARED_NOTE, "--content", SHARED_CONTENT, "--if-absent");
    // the store lands beside the app, as a synced one would: what new-id copies is its bytes
    const sharedStore = path.join(app.vaultDir, ".inteligir", "annotations", `${SHARED_ID}.json`);
    await mkdir(path.dirname(sharedStore), { recursive: true });
    await writeFile(sharedStore, SHARED_STORE, "utf-8");
    const original = path.join(app.vaultDir, SHARED_NOTE);
    const originalBytes = await readFile(original, "utf-8");
    const storeBytes = await readFile(sharedStore, "utf-8");
    // Finder's duplicate: the same bytes, landed beside the app rather than through it
    await copyFile(original, path.join(app.vaultDir, SHARED_COPY));
    const given = await cli("vault", "new-id", SHARED_COPY, "--json");
    const newId = newIdOutputSchema.parse(JSON.parse(given.stdout)).id;
    expect(newId !== SHARED_ID, "the copy answers an id of its own");
    expectEq(
      await readFile(path.join(app.vaultDir, SHARED_COPY), "utf-8"),
      originalBytes.replace(SHARED_ID, newId),
      "the copy's new id stands on the line the shared one did, every other byte kept",
    );
    expectEq(await readFile(original, "utf-8"), originalBytes, "the original is untouched");
    expectEq(
      await readFile(
        path.join(app.vaultDir, ".inteligir", "annotations", `${newId}.json`),
        "utf-8",
      ),
      storeBytes,
      "the copy's annotation store is the original's, byte for byte",
    );
    expectEq(await readFile(sharedStore, "utf-8"), storeBytes, "the original keeps its own");

    ctx.log("the library: a PDF and a link, listed, found and tagged");
    await drivesTheLibrary(ctx, app, cli);

    ctx.log("status reports the scripted agent");
    const status = await cli("status");
    expect(status.stdout.includes("Agent: scripted"), "status names the scripted runtime");
  },
};
