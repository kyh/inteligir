// a scenario's own turbo build, once per run and one at a time: lanes run in one process, a
// second build of one package would rewrite the outputs a scenario in another lane is serving
// from (the Worker serves its assets from its build output for its whole life), and two turbo
// runs at once would restore and write the same cache together. A build waiting its turn behind
// another workspace's says how long it waited to whoever hears it (the runner's deadline), since a
// scenario's budget covers its own build, not every one a lane before it asked for

import { AsyncLocalStorage } from "node:async_hooks";
import { buildProcessEnv, exec } from "./exec";

interface Build {
  // settles once the builds queued before this one have ended, either way
  started: Promise<void>;
  done: Promise<void>;
}

const built = new Map<string, Build>();
// the last build asked for, settled either way: the next one starts once it ends
let queue: Promise<void> = Promise.resolve();

const queueWaits = new AsyncLocalStorage<(waitedMs: number) => void>();

// runs `body` hearing, for each build it awaits, how long that build sat queued before it started
export const hearingBuildQueueWaits = async (
  onWait: (waitedMs: number) => void,
  body: () => Promise<void>,
): Promise<void> => {
  await queueWaits.run(onWait, body);
};

export interface TurboBuildArgs {
  repoRoot: string;
  // the one workspace built, as `--filter` names it
  filter: string;
  timeoutMs: number;
  onLog: (line: string) => void;
}

const settled = async (build: Promise<void>): Promise<void> => {
  try {
    await build;
  } catch {
    // its own caller reports it; the next build runs regardless
  }
};

const buildAfter = async (started: Promise<void>, args: TurboBuildArgs): Promise<void> => {
  await started;
  await exec("pnpm", ["turbo", "run", "build", `--filter=${args.filter}`], {
    cwd: args.repoRoot,
    env: buildProcessEnv(),
    timeoutMs: args.timeoutMs,
  });
};

const awaitBuild = async (build: Build): Promise<void> => {
  const askedAt = Date.now();
  await build.started;
  const waitedMs = Date.now() - askedAt;
  if (waitedMs > 0) {
    queueWaits.getStore()?.(waitedMs);
  }
  await build.done;
};

// a failed build is forgotten, so the next scenario that asks builds again and says why itself
export const turboBuildOnce = async (args: TurboBuildArgs): Promise<void> => {
  const known = built.get(args.filter);
  if (known !== undefined) {
    args.onLog(`${args.filter} is this run's build (turbo, built once per run)`);
    await awaitBuild(known);
    return;
  }
  args.onLog(`building ${args.filter} (turbo)`);
  const started = queue;
  const build: Build = { done: buildAfter(started, args), started };
  queue = settled(build.done);
  built.set(args.filter, build);
  try {
    await awaitBuild(build);
  } catch (error) {
    built.delete(args.filter);
    throw error;
  }
};
