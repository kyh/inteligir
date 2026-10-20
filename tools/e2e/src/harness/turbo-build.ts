// a scenario's own turbo build, once per run and one at a time: lanes run in one process, a
// second build of one package would rewrite the outputs a scenario in another lane is serving
// from (the Worker serves its assets from its build output for its whole life), and two turbo
// runs at once would restore and write the same cache together

import { buildProcessEnv, exec } from "./exec";

const built = new Map<string, Promise<void>>();
// the last build asked for, settled either way: the next one starts once it ends
let queue: Promise<void> = Promise.resolve();

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

const buildAfter = async (previous: Promise<void>, args: TurboBuildArgs): Promise<void> => {
  await previous;
  await exec("pnpm", ["turbo", "run", "build", `--filter=${args.filter}`], {
    cwd: args.repoRoot,
    env: buildProcessEnv(),
    timeoutMs: args.timeoutMs,
  });
};

// a failed build is forgotten, so the next scenario that asks builds again and says why itself
export const turboBuildOnce = async (args: TurboBuildArgs): Promise<void> => {
  const known = built.get(args.filter);
  if (known !== undefined) {
    args.onLog(`${args.filter} is this run's build (turbo, built once per run)`);
    await known;
    return;
  }
  args.onLog(`building ${args.filter} (turbo)`);
  const build = buildAfter(queue, args);
  queue = settled(build);
  built.set(args.filter, build);
  try {
    await build;
  } catch (error) {
    built.delete(args.filter);
    throw error;
  }
};
