import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, expectEq } from "../harness/assert";
import { exec, hermeticProcessEnv } from "../harness/exec";
import type { Scenario } from "../harness/scenario";

// a cold vite build of the whole Worker; a cached one returns at once.
const BUILD_TIMEOUT_MS = 300_000;

export const builtWorkerBoot: Scenario = {
  name: "built-worker-boot",
  description: "the vite-built Worker bundle boots under wrangler dev and answers its routes",
  async run(context) {
    // built through turbo, not looked for on disk: a present artifact may be stale and boot last
    // week's Worker.
    await exec("pnpm", ["turbo", "run", "build", "--filter=@repo/web"], {
      cwd: context.repoRoot,
      env: hermeticProcessEnv(),
      timeoutMs: BUILD_TIMEOUT_MS,
    });
    const builtConfig = join(context.repoRoot, "apps", "web", "dist", "server", "wrangler.json");
    expect(existsSync(builtConfig), `the web build emitted no ${builtConfig}`);

    const worker = await context.cloudWorker({ builtConfig });

    // a bundle whose module scope threw answers 500 to everything.
    const session = await fetch(`${worker.origin}/api/auth/get-session`, {
      headers: { origin: worker.origin },
    });
    expectEq(session.status, 200, "get-session against the built bundle");
    const account = await fetch(`${worker.origin}/v1/account`);
    expectEq(account.status, 401, "an unauthenticated device route against the built bundle");
  },
};
