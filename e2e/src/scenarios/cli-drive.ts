// The CLI against a real instance, invoked the way an AGENT invokes it: the
// bare command name, resolved through the PATH the runtime composes for a
// codex shell (agent-shell-env.ts). An absolute path to dist/index.js would
// prove the code works and leave the headline flow — a model typing
// `inteligir …` in bash — untested; that gap is exactly what this scenario
// exists to close. Then: write a note, search finds it, thread new + wait
// under the scripted driver, show renders the timeline.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { buildAgentShellEnv, resolveCliBinDir } from "@repo/app/node/agent/agent-shell-env";
import { expect, expectEq } from "../harness/assert";
import { exec, hermeticProcessEnv, type ExecResult } from "../harness/exec";
import type { Scenario } from "../harness/scenario";

const NOTE_PATH = "notes/cli-drive.md";
const NOTE_TOKEN = "clidrivetoken";
const NOTE_CONTENT = `# CLI drive\n\nA note carrying ${NOTE_TOKEN} for search.\n`;
const PROMPT = "Hello from cli-drive";
const SEARCH_DEADLINE_MS = 30_000;

export const cliDrive: Scenario = {
  name: "cli-drive",
  description: "the built CLI drives a real instance: vault write, search, thread new+wait+show",
  async run(ctx) {
    ctx.log("build the CLI bundle");
    await exec("pnpm", ["--filter", "@repo/cli", "build"], {
      cwd: ctx.repoRoot,
      env: hermeticProcessEnv(),
      timeoutMs: 120_000,
    });

    const app = await ctx.boot({
      name: "solo",
      extraEnv: { INTELIGIR_AGENT: "scripted" },
    });

    // The env a codex shell gets, composed by the app's own resolver against
    // this checkout — so a broken PATH or a missing bin fails HERE.
    const cliBinDir = resolveCliBinDir(
      pathToFileURL(join(ctx.repoRoot, "apps", "app", "src", "node", "agent", "x.ts")).href,
    );
    expect(cliBinDir !== null, "the app resolves a CLI bin directory for the agent's PATH");
    const agentShellEnv = buildAgentShellEnv({
      serverUrl: app.baseUrl,
      env: hermeticProcessEnv(),
      cliBinDir,
      memoryDir: app.memoryDir,
    });

    // `inteligir`, not a path: found through PATH exactly as an agent's bash
    // would find it. `shell: false` still resolves a bare name via PATH.
    const cli = (...argv: string[]): Promise<ExecResult> =>
      exec("inteligir", argv, {
        env: { ...hermeticProcessEnv(), ...agentShellEnv },
        timeoutMs: 60_000,
      });

    ctx.log("the bare command resolves through the agent's PATH");
    const which = await cli("--version");
    expect(which.stdout.trim().length > 0, "`inteligir --version` answered");

    ctx.log("vault write + read through the CLI, verified on disk");
    await cli("vault", "write", NOTE_PATH, "--content", NOTE_CONTENT);
    const readBack = await cli("vault", "read", NOTE_PATH);
    expectEq(readBack.stdout, NOTE_CONTENT, "CLI read-back matches");
    expectEq(
      await readFile(join(app.vaultDir, NOTE_PATH), "utf8"),
      NOTE_CONTENT,
      "written bytes on disk",
    );
    const listing = await cli("vault", "list", "notes");
    expect(listing.stdout.includes(NOTE_PATH), "the listing names the note");

    ctx.log("search finds the note (projection is async — poll)");
    const searchDeadline = Date.now() + SEARCH_DEADLINE_MS;
    for (;;) {
      const search = await cli("search", NOTE_TOKEN, "--json");
      const parsed: unknown = JSON.parse(search.stdout);
      const results =
        typeof parsed === "object" && parsed !== null && "results" in parsed
          ? parsed.results
          : undefined;
      if (Array.isArray(results) && results.length > 0) {
        expect(
          results.some(
            (result) =>
              typeof result === "object" &&
              result !== null &&
              "path" in result &&
              result.path === NOTE_PATH,
          ),
          "search names the written note",
        );
        break;
      }
      expect(Date.now() < searchDeadline, `search still empty after ${SEARCH_DEADLINE_MS}ms`);
      await delay(250);
    }

    ctx.log("thread new + wait under the scripted driver");
    const created = await cli("thread", "new", PROMPT, "--json");
    const createdParsed: unknown = JSON.parse(created.stdout);
    let threadId: string | undefined;
    if (
      typeof createdParsed === "object" &&
      createdParsed !== null &&
      "thread" in createdParsed &&
      typeof createdParsed.thread === "object" &&
      createdParsed.thread !== null &&
      "id" in createdParsed.thread &&
      typeof createdParsed.thread.id === "string"
    ) {
      threadId = createdParsed.thread.id;
    }
    expect(threadId !== undefined, "thread new --json names the thread id");
    if (threadId === undefined) {
      return;
    }
    // exec throws on a non-zero exit, so a clean return IS the exit-0 assert.
    const waited = await cli("thread", "wait", threadId, "--timeout", "60");
    expect(waited.stdout.includes("is idle"), "wait reports the idle settle");

    ctx.log("show renders the timeline");
    const shown = await cli("thread", "show", threadId);
    expect(shown.stdout.includes(`Thread ${threadId} — idle`), "show names the settled thread");
    expect(shown.stdout.includes("── user ──"), "the user turn is rendered");
    expect(shown.stdout.includes(`Noted: ${PROMPT}`), "the scripted agent's reply is rendered");
    expect(
      shown.stdout.includes(`~ add Agent/${threadId}.md`),
      "the scripted driver's file change is rendered",
    );

    ctx.log("status reports the scripted agent");
    const status = await cli("status");
    expect(status.stdout.includes("Agent: scripted"), "status names the scripted runtime");
  },
};
