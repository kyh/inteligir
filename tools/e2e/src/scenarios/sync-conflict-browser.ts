import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { parseEval } from "../harness/agent-browser";
import { expect, expectEq } from "../harness/assert";
import type { InstanceApi } from "../harness/instance";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { clickToastAction, EDITOR, TOAST_TEXT } from "../harness/selectors";

const NOTE = "Plans.md";
const BASE = "# Plans\n\nshared line\n";
const ON_A = "# Plans\n\nedited on A\n";
const ON_B = "# Plans\n\nedited on B\n";
const BOTH_KEPT = "Both versions of “Plans” were kept";
// every sync is an explicit call, so the divergence between A and B is deterministic.
const NO_AUTO_SYNC = { INTELIGIR_SYNC_INTERVAL_MS: "0" };
const DEADLINE_MS = 30_000;
// past sonner's own 4s: a notice that closed by itself while the user typed was never heard.
const PAST_TOAST_DEFAULT_MS = 5000;

const syncExpectClean = async (api: InstanceApi, label: string) => {
  const status = await api.vault.syncNow();
  expect(
    status.state === "clean",
    `${label}: expected a clean sync, got "${status.state}" (lastError: ${status.lastError ?? "none"})`,
  );
  return status;
};

const write = async (api: InstanceApi, content: string): Promise<void> => {
  await api.vault.write({ content, guard: { kind: "overwrite" }, path: NOTE });
};

export const syncConflictBrowser: Scenario = {
  description:
    "a sync that copies another device's version aside tells the open window so, and Open shows that version",
  name: "sync-conflict-browser",
  async run(ctx) {
    const remote = await ctx.bareRemote();
    const a = await ctx.boot({ extraEnv: NO_AUTO_SYNC, name: "a", vaultRemote: remote });
    await write(a.api, BASE);
    await syncExpectClean(a.api, "A with the base");

    const b = await ctx.boot({ extraEnv: NO_AUTO_SYNC, name: "b", vaultRemote: remote });
    await syncExpectClean(b.api, "B taking the base");

    const agentBrowser = await ctx.browser("sync-conflict");
    ctx.log(`opening B at ${b.baseUrl}/`);
    await agentBrowser.openWorkspace(b);
    const readToasts = async (): Promise<string> =>
      parseEval(await agentBrowser(["eval", TOAST_TEXT]), z.string());

    ctx.log("A and B change the same line; A syncs first");
    await write(a.api, ON_A);
    await syncExpectClean(a.api, "A after its edit");
    await write(b.api, ON_B);

    ctx.log("B syncs: its line stays and A's is copied aside");
    const merged = await syncExpectClean(b.api, "B meeting A's edit");
    const [report] = merged.conflicts;
    expect(
      report?.kind === "copied" && report.path === NOTE,
      `B reports ${NOTE} copied aside (got ${JSON.stringify(merged.conflicts)})`,
    );
    const copyName = `“${path.posix.basename(report.copyPath, ".md")}”`;

    ctx.log("the open window says both were kept, and names the copy");
    const toasts = await pollUntil(readToasts, (text) => text.includes(BOTH_KEPT), {
      deadlineMs: DEADLINE_MS,
      describe: (text) => `no conflict notice — the toasts said:\n${text}`,
    });
    expect(toasts.includes(copyName), `the notice does not name ${copyName}:\n${toasts}`);

    await delay(PAST_TOAST_DEFAULT_MS);
    const later = await readToasts();
    expect(
      later.includes(BOTH_KEPT),
      `the conflict notice closed by itself before anyone read it:\n${later}`,
    );

    ctx.log("Open shows A's version");
    expectEq(
      parseEval(await agentBrowser(["eval", clickToastAction(BOTH_KEPT)]), z.string()),
      "clicked",
      "the notice's Open",
    );
    await pollUntil(
      async () => await agentBrowser(["get", "text", EDITOR]),
      (text) => text.includes("edited on A"),
      {
        deadlineMs: DEADLINE_MS,
        describe: (text) => `Open never showed A's line — the editor held:\n${text}`,
      },
    );
  },
};
