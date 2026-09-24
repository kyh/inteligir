import { writeFile } from "node:fs/promises";
import path from "node:path";
import { readServerFile } from "inteligir/server/server-file";
import { expect } from "../harness/assert";
import type { AppInstance } from "../harness/instance";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";

const WATCHED_PATH = "Watched.md";
const BODY_TOKEN = "debugtracebodytoken";
const IGNORED_NAME = ".inteligir-tmp-e2e";
const DEADLINE_MS = 30_000;
const WATCH_ROUND_MS = 5000;

const debugLines = (app: AppInstance): string[] =>
  app
    .outputTail(Number.POSITIVE_INFINITY)
    .split("\n")
    .filter((line) => line.includes("[debug:"));

// rewritten each round: the first write can land before the watcher subscribes, and only a write
// on disk reaching the index proves the watcher made its decisions.
const writeUntilIndexed = async (app: AppInstance): Promise<void> => {
  let round = 0;
  let rewriteAt = 0;
  await pollUntil(
    async () => {
      if (Date.now() >= rewriteAt) {
        await writeFile(
          path.join(app.vaultDir, WATCHED_PATH),
          `# Watched\n\n${BODY_TOKEN} round ${round}\n`,
        );
        round += 1;
        rewriteAt = Date.now() + WATCH_ROUND_MS;
      }
      const { results } = await app.api.knowledge.search({ q: BODY_TOKEN });
      return results.some((result) => result.path === WATCHED_PATH);
    },
    (indexed) => indexed,
    {
      deadlineMs: DEADLINE_MS,
      describe: () => `${app.name} never indexed the write to ${WATCHED_PATH} (${DEADLINE_MS}ms)`,
    },
  );
};

export const debugLogTrace: Scenario = {
  description:
    "INTELIGIR_DEBUG traces what the watcher kept and dropped and the index's verdict, by path and never by content; unset, nothing",
  name: "debug-log",
  async run(ctx) {
    const traced = await ctx.boot({
      extraEnv: { INTELIGIR_DEBUG: "watcher,knowledge" },
      name: "traced",
    });
    const quiet = await ctx.boot({ name: "quiet" });

    ctx.log("an external write reaches both indexes");
    await writeUntilIndexed(traced);
    await writeUntilIndexed(quiet);

    ctx.log("the traced instance names the note it kept, delivered and indexed");
    const kept = /\[debug:watcher\] \w+ Watched\.md: kept$/u;
    const lines = debugLines(traced);
    expect(
      lines.some((line) => kept.test(line)),
      `no kept verdict among:\n${lines.join("\n")}`,
    );
    expect(
      lines.some((line) => line.endsWith("[debug:watcher] delivered: Watched.md")),
      `no delivery among:\n${lines.join("\n")}`,
    );
    expect(
      lines.some((line) => line.endsWith("[debug:knowledge] Watched.md: changed, indexing")),
      `no index verdict among:\n${lines.join("\n")}`,
    );

    ctx.log("and why it dropped a staging file");
    await writeFile(path.join(traced.vaultDir, IGNORED_NAME), `${BODY_TOKEN} staged\n`);
    const dropped = `: dropped, under ignored entry ${IGNORED_NAME}`;
    const withDrop = await pollUntil(
      async () => await Promise.resolve(debugLines(traced)),
      (current) => current.some((line) => line.endsWith(dropped)),
      {
        deadlineMs: DEADLINE_MS,
        describe: (current) => `no drop verdict for ${IGNORED_NAME} among:\n${current.join("\n")}`,
      },
    );

    ctx.log("no line carries a note's content or the server's credential");
    const server = readServerFile(traced.dataDir);
    expect(server !== null, "the traced server published no server.json");
    const leaked = withDrop.filter(
      (line) => line.includes(BODY_TOKEN) || line.includes(server.token),
    );
    expect(leaked.length === 0, `a debug line leaked:\n${leaked.join("\n")}`);

    ctx.log("unset, the other instance wrote no debug line at all");
    const quietLines = debugLines(quiet);
    expect(quietLines.length === 0, `the untraced instance wrote:\n${quietLines.join("\n")}`);
  },
};
