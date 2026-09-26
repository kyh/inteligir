import { readFile } from "node:fs/promises";
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
const undoOutputSchema = z.looseObject({ reverted: z.array(z.string()) });

export const cliDrive: Scenario = {
  description:
    "the CLI drives a real instance: vault write, search, action new+wait+show+changes+undo",
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

    ctx.log("undo takes the turn back");
    const undone = await cli("action", "undo", threadId, "--json");
    const undoneParsed = undoOutputSchema.safeParse(JSON.parse(undone.stdout));
    expectEq(
      undoneParsed.data?.reverted.join(","),
      `Agent/${threadId}.md`,
      "the undo reverted the note the turn made",
    );
    expectEq(
      await readFile(path.join(app.vaultDir, "Agent", `${threadId}.md`), "utf-8").catch(() => null),
      null,
      "the note the untouched turn made is gone from disk",
    );

    ctx.log("status reports the scripted agent");
    const status = await cli("status");
    expect(status.stdout.includes("Agent: scripted"), "status names the scripted runtime");
  },
};
