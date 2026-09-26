import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { resolveCliBinDir, toShellEnv } from "inteligir/server/agent-shell-env";
import { z } from "zod";
import { expect, expectEq } from "../harness/assert";
import { exec, hermeticProcessEnv } from "../harness/exec";
import type { ExecResult } from "../harness/exec";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";

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
const duplicateIdRowSchema = z.looseObject({ id: z.string(), paths: z.array(z.string()) });
type DuplicateIdRow = z.infer<typeof duplicateIdRowSchema>;
const problemsOutputSchema = z.looseObject({
  duplicateIds: z.looseObject({ rows: z.array(duplicateIdRowSchema) }),
});
const newIdOutputSchema = z.looseObject({ comments: z.literal("copied"), id: z.string() });

const SHARED_NOTE = "notes/shared.md";
const SHARED_COPY = "notes/shared copy.md";
const SHARED_ID = "0f6a3b1e-5c2d-4e8f-9a7b-1c3d5e7f9a0b";
const SHARED_CONTENT = `---\ntitle: Shared\nid: ${SHARED_ID}\n---\n# Shared\n`;

const duplicateIds = async (
  cli: (...argv: string[]) => Promise<ExecResult>,
): Promise<DuplicateIdRow[]> => {
  const problems = await cli("problems", "--json");
  return problemsOutputSchema.parse(JSON.parse(problems.stdout)).duplicateIds.rows;
};

export const cliDrive: Scenario = {
  description:
    "the CLI drives a real instance: vault write, search, action new+wait+show+changes, vault new-id",
  name: "cli-drive",
  // bin/inteligir runs src/ under tsx in a checkout; the bundle is built-cli-boot's to test, and
  // the packed tarball pnpm smoke:cli's.
  async run(ctx) {
    const app = await ctx.boot({
      extraEnv: { INTELIGIR_AGENT: "scripted" },
      name: "solo",
    });

    // composed by the server's own resolver, so a broken PATH or a missing bin fails here.
    const cliBinDir = resolveCliBinDir(path.join(ctx.repoRoot, "apps", "cli", "bin"));
    expect(cliBinDir !== null, "the app resolves a CLI bin directory for the agent's PATH");
    const agentShellEnv = toShellEnv(
      { cliBinDir, connectedDirs: [], dataDir: app.dataDir, skillsDir: null },
      hermeticProcessEnv(),
    );

    // the bare name through PATH, as an agent's bash finds it; an absolute path would leave that
    // flow untested.
    const cli = async (...argv: string[]): Promise<ExecResult> =>
      await exec("inteligir", argv, {
        env: { ...hermeticProcessEnv(), ...agentShellEnv },
        timeoutMs: 60_000,
      });

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

    ctx.log("a byte copy shares its original's id until vault new-id gives it one of its own");
    await cli("vault", "write", SHARED_NOTE, "--content", SHARED_CONTENT, "--if-absent");
    await cli("comment", "add", SHARED_NOTE, "The first thread");
    await cli("comment", "add", SHARED_NOTE, "The second thread");
    const original = path.join(app.vaultDir, SHARED_NOTE);
    const originalBytes = await readFile(original, "utf-8");
    const sharedStore = path.join(app.vaultDir, ".inteligir", "comments", `${SHARED_ID}.json`);
    const storeBytes = await readFile(sharedStore, "utf-8");
    // Finder's duplicate: the same bytes, landed beside the app rather than through it
    await copyFile(original, path.join(app.vaultDir, SHARED_COPY));
    const sharing = (rows: DuplicateIdRow[]): boolean =>
      rows.some((row) => row.id === SHARED_ID && row.paths.includes(SHARED_COPY));
    await pollUntil(async () => await duplicateIds(cli), sharing, {
      deadlineMs: SEARCH_DEADLINE_MS,
      describe: (rows) => `problems never listed the copy's shared id: ${JSON.stringify(rows)}`,
    });
    const given = await cli("vault", "new-id", SHARED_COPY, "--json");
    const newId = newIdOutputSchema.parse(JSON.parse(given.stdout)).id;
    expect(newId !== SHARED_ID, "the copy answers an id of its own");
    await pollUntil(
      async () => await duplicateIds(cli),
      (rows) => rows.length === 0,
      {
        deadlineMs: SEARCH_DEADLINE_MS,
        describe: (rows) => `problems still lists shared ids: ${JSON.stringify(rows)}`,
      },
    );
    expectEq(
      await readFile(path.join(app.vaultDir, SHARED_COPY), "utf-8"),
      originalBytes.replace(SHARED_ID, newId),
      "the copy's new id stands on the line the shared one did, every other byte kept",
    );
    expectEq(await readFile(original, "utf-8"), originalBytes, "the original is untouched");
    expectEq(
      await readFile(path.join(app.vaultDir, ".inteligir", "comments", `${newId}.json`), "utf-8"),
      storeBytes,
      "the copy's comment store is the original's, byte for byte",
    );
    expectEq(await readFile(sharedStore, "utf-8"), storeBytes, "the original keeps its own");

    ctx.log("status reports the scripted agent");
    const status = await cli("status");
    expect(status.stdout.includes("Agent: scripted"), "status names the scripted runtime");
  },
};
