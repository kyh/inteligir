import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect } from "../harness/assert";
import type { AppInstance } from "../harness/instance";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";

const STALL_MS = 30_000;
const SLOW_PATH = "slow.md";
const SLOW_TOKEN = "slothtoken";
const FAST_PATH = "fast.md";
const FAST_TOKEN = "swifttoken";
const BOOT_LINE_TAIL = 200;

const searchPaths = async (app: AppInstance, token: string): Promise<string[]> => {
  const { results } = await app.api.knowledge.search({ q: token });
  return results.map((result) => result.path);
};

export const slowStorage: Scenario = {
  description:
    "a doc whose read stalls 30s leaves the reconcile to finish and search to answer without it, and is indexed once its read lands",
  name: "slow-storage",
  async run(ctx) {
    const app = await ctx.boot({
      extraEnv: { INTELIGIR_SLOW_READS: `${String(STALL_MS)}:${SLOW_PATH}` },
      name: "slow",
      seedVault: async (vaultDir) => {
        await writeFile(path.join(vaultDir, FAST_PATH), `# Fast\n\n${FAST_TOKEN}\n`);
        await writeFile(path.join(vaultDir, SLOW_PATH), `# Slow\n\n${SLOW_TOKEN}\n`);
      },
    });
    const healthy = Date.now();

    ctx.log("search answers while the slow doc's read is still held");
    const fast = await searchPaths(app, FAST_TOKEN);
    const waited = Date.now() - healthy;
    expect(fast.includes(FAST_PATH), `search for the fast doc answered ${JSON.stringify(fast)}`);
    expect(
      waited < STALL_MS / 2,
      `the first search waited ${String(waited)}ms, as if on the stalled read`,
    );
    const early = await searchPaths(app, SLOW_TOKEN);
    expect(
      !early.includes(SLOW_PATH),
      "the slow doc was indexed before its read could have answered",
    );

    ctx.log("the boot line counts the deferred read");
    await pollUntil(
      async () => await Promise.resolve(app.outputTail(BOOT_LINE_TAIL)),
      (tail) => /\[boot\] .*deferred 1\)/u.test(tail),
      {
        deadlineMs: STALL_MS / 2,
        describe: (tail) => `no boot line counting one deferred read:\n${tail}`,
      },
    );

    ctx.log("the slow doc is indexed once its read lands");
    await pollUntil(
      async () => await searchPaths(app, SLOW_TOKEN),
      (paths) => paths.includes(SLOW_PATH),
      {
        deadlineMs: STALL_MS * 2,
        describe: (paths) => `search for the slow doc still answers ${JSON.stringify(paths)}`,
      },
    );
  },
};
