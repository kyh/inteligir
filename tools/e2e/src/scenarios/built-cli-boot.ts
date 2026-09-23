import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { expect, expectEq } from "../harness/assert";
import { exec, hermeticProcessEnv } from "../harness/exec";
import type { AppInstance } from "../harness/instance";
import type { Scenario } from "../harness/scenario";

const WRITTEN_PATH = "notes/built.md";
const WRITTEN_TOKEN = "builtwritetoken";
const WATCHED_PATH = "Watched.md";
const WATCHED_TOKEN = "builtwatchtoken";
const DEADLINE_MS = 30_000;
const POLL_INTERVAL_MS = 250;
const WATCH_ROUND_MS = 5000;

const manifestSchema = z.looseObject({ version: z.string() });
const statusOutputSchema = z.looseObject({ dataDir: z.string(), version: z.string() });

const searchFinds = async (app: AppInstance, token: string, notePath: string): Promise<boolean> => {
  const { results } = await app.api.knowledge.search({ q: token });
  return results.some((result) => result.path === notePath);
};

export const builtCliBoot: Scenario = {
  description:
    "the esbuild bundle npm and the .app run boots, migrates, indexes, watches and serves its UI",
  name: "built-cli-boot",
  // no build step: the runner builds this bundle at suite start, through turbo.
  async run(ctx) {
    const cliDir = path.join(ctx.repoRoot, "apps", "cli");
    const distDir = path.join(cliDir, "dist");
    const app = await ctx.boot({ mode: "built", name: "built" });

    ctx.log("GET / answers the staged workspace UI");
    const shell = await fetch(app.baseUrl, { headers: { accept: "text/html" } });
    expectEq(shell.status, 200, "GET / on the built server");
    const staged = await readFile(path.join(distDir, "ui", "index.html"), "utf-8");
    expect((await shell.text()) === staged, "GET / answers dist/ui/index.html byte for byte");

    ctx.log("a write through the API reaches the index");
    await app.api.vault.write({ content: `# Built\n\n${WRITTEN_TOKEN}\n`, path: WRITTEN_PATH });
    const writeDeadline = Date.now() + DEADLINE_MS;
    while (!(await searchFinds(app, WRITTEN_TOKEN, WRITTEN_PATH))) {
      expect(Date.now() < writeDeadline, `search never found ${WRITTEN_PATH} (${DEADLINE_MS}ms)`);
      await delay(POLL_INTERVAL_MS);
    }

    // the child is resolved as a sibling of whichever chunk forks it, and the proxy respawns a
    // child that cannot load forever, so only an external write reaching the index proves it
    // lives. rewritten each round: the first can land before the child subscribes.
    ctx.log("a write on disk reaches the index through the forked watcher");
    const watchDeadline = Date.now() + DEADLINE_MS;
    let seen = false;
    for (let round = 0; !seen; round += 1) {
      expect(
        Date.now() < watchDeadline,
        `the watcher never reported an external write to ${WATCHED_PATH} (${DEADLINE_MS}ms)`,
      );
      await writeFile(
        path.join(app.vaultDir, WATCHED_PATH),
        `# Watched\n\n${WATCHED_TOKEN} round ${round}\n`,
      );
      const roundEnd = Date.now() + WATCH_ROUND_MS;
      while (!seen && Date.now() < roundEnd) {
        await delay(POLL_INTERVAL_MS);
        seen = await searchFinds(app, WATCHED_TOKEN, WATCHED_PATH);
      }
    }

    // a client verb loads other chunks than serve does, and reads the version through the
    // package-root rule a misplaced chunk would break.
    ctx.log("a client verb from the same bundle drives the server");
    const status = await exec(
      process.execPath,
      [path.join(distDir, "index.js"), "status", "--json"],
      {
        env: { ...hermeticProcessEnv(), INTELIGIR_DATA_DIR: app.dataDir, NODE_ENV: "production" },
      },
    );
    const reported = statusOutputSchema.parse(JSON.parse(status.stdout));
    expectEq(reported.dataDir, app.dataDir, "status --json names the instance's data dir");
    const manifest = manifestSchema.parse(
      JSON.parse(await readFile(path.join(cliDir, "package.json"), "utf-8")),
    );
    expectEq(reported.version, manifest.version, "the version the bundle read from package.json");
  },
};
