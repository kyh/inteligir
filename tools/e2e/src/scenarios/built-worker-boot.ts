// The BUILT Worker bundle, booted and answered — the artifact `wrangler
// deploy` ships, not the source graph every other gate runs. The failure this
// exists for is a module-scope crash only the vite-built bundle has (a
// tree-shaken binding still referenced by an emitted namespace): the unit
// suites and the source-entry harness both boot src/worker/index.ts and stay
// green while every deployed request 500s.
//
// The bundle is built THROUGH TURBO on every run rather than looked for on
// disk: turbo's hash is what says the artifact matches the source, while a
// present artifact says only that some build once ran — a stale one boots
// last week's Worker and passes for it. Fresh, the run is a cache hit.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, expectEq } from "../harness/assert";
import { exec, hermeticProcessEnv } from "../harness/exec";
import type { Scenario } from "../harness/scenario";

/** A cold `vite build` of the whole Worker, durable-git included; a cached
 *  one returns at once. */
const BUILD_TIMEOUT_MS = 300_000;

export const builtWorkerBoot: Scenario = {
  name: "built-worker-boot",
  description: "the vite-built Worker bundle boots under wrangler dev and answers its routes",
  async run(context) {
    await exec("pnpm", ["turbo", "run", "build", "--filter=@repo/web"], {
      cwd: context.repoRoot,
      env: hermeticProcessEnv(),
      timeoutMs: BUILD_TIMEOUT_MS,
    });
    // The vite plugin emits the deploy config beside the bundle; the harness
    // passes it explicitly (see cloud-worker.ts on the .wrangler/deploy
    // redirect), and its own `main` names the built module.
    const builtConfig = join(context.repoRoot, "apps", "web", "dist", "server", "wrangler.json");
    expect(existsSync(builtConfig), `the web build emitted no ${builtConfig}`);

    const worker = await context.cloudWorker({ builtConfig });

    // A bundle whose module scope threw answers 500 to everything, so these
    // two statuses are the boot the deploy needs: the auth surface serves,
    // and the device-authed API refuses rather than crashes.
    const session = await fetch(`${worker.origin}/api/auth/get-session`, {
      headers: { origin: worker.origin },
    });
    expectEq(session.status, 200, "get-session against the built bundle");
    const account = await fetch(`${worker.origin}/v1/account`);
    expectEq(account.status, 401, "an unauthenticated device route against the built bundle");
  },
};
