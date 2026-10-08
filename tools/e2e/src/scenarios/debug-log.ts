import path from "node:path";
import { readDeviceCredential } from "inteligir/server/cloud/credential-store";
import { readServerFile } from "inteligir/server/server-file";
import { expect } from "../harness/assert";
import { signInOwner, signUp } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { appLaunchEnv, describeExecError, exec } from "../harness/exec";
import type { AppInstance } from "../harness/instance";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { untilThreadIdle } from "../harness/threads";

const BODY_TOKEN = "debugtracebodytoken";
const DEADLINE_MS = 30_000;
// the step every pass runs first, traced as `session <id> push: <outcome>`
const PUSH_TRACE = /\[debug:sync\] session \S+ push: \S+$/u;

const debugLines = (app: AppInstance): string[] =>
  app
    .outputTail(Number.POSITIVE_INFINITY)
    .split("\n")
    .filter((line) => line.includes("[debug:"));

export const debugLogTrace: Scenario = {
  description:
    "INTELIGIR_DEBUG traces each sync step by id and never by content or credential; unset, nothing; a misspelt namespace refuses the boot",
  name: "debug-log",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    ctx.log("a namespace no build traces refuses the boot, naming the ones it does");
    let refused = "";
    try {
      await exec(path.join(ctx.repoRoot, "apps", "cli", "bin", "inteligir"), ["serve"], {
        env: {
          ...appLaunchEnv(),
          INTELIGIR_DATA_DIR: path.join(ctx.scratchDir, "refused"),
          INTELIGIR_DEBUG: "watcher",
        },
      });
    } catch (error) {
      refused = describeExecError(error);
    }
    expect(
      refused.includes("INTELIGIR_DEBUG") && refused.includes("sync"),
      `a misspelt namespace booted, or failed without naming the variable:\n${refused}`,
    );

    const worker = await ctx.cloudWorker();
    await signUp(worker.origin);
    const env = { INTELIGIR_AGENT: "scripted", INTELIGIR_CLOUD_URL: worker.origin };
    const traced = await ctx.boot({
      extraEnv: { ...env, INTELIGIR_DEBUG: "sync" },
      name: "traced",
    });
    const quiet = await ctx.boot({ extraEnv: env, name: "quiet" });

    ctx.log("both sign in, and each pushes a turn whose words must not reach a trace");
    for (const [app, label] of [
      [traced, "traced"],
      [quiet, "quiet"],
    ] as const) {
      await signInOwner(app, label, `E2E ${label}`);
      const { thread } = await app.api.threads.create({ title: "traced turn" });
      await app.api.threads.send({ text: `${BODY_TOKEN} from ${label}`, threadId: thread.id });
      await untilThreadIdle(app.api, thread.id);
      await app.api.cloud.syncNow();
    }

    ctx.log("the traced instance names each step its passes ran");
    const lines = await pollUntil(
      async () => await Promise.resolve(debugLines(traced)),
      (current) => current.some((line) => PUSH_TRACE.test(line)),
      {
        deadlineMs: DEADLINE_MS,
        describe: (current) => `no push step among:\n${current.join("\n")}`,
      },
    );

    ctx.log("no line carries a message's words or a credential");
    const server = readServerFile(traced.dataDir);
    expect(server !== null, "the traced server published no server.json");
    const device = readDeviceCredential(traced.dataDir);
    expect(device !== null, "the traced instance holds no device credential");
    const leaked = lines.filter(
      (line) =>
        line.includes(BODY_TOKEN) ||
        line.includes(server.token) ||
        line.includes(device.credential),
    );
    expect(leaked.length === 0, `a debug line leaked:\n${leaked.join("\n")}`);

    ctx.log("unset, the other instance wrote no debug line at all");
    const quietLines = debugLines(quiet);
    expect(quietLines.length === 0, `the untraced instance wrote:\n${quietLines.join("\n")}`);
  },
};
