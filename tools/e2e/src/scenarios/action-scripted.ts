// The ACTION loop (#587's surface), end to end: a thread ATTACHED to the
// note it was composed over (`originDocPath` alone — no marker), a scripted
// turn writing the vault through the agent path, the guarded CAS write the
// editor saves through, a CAS_MISMATCH whose body carries the current bytes,
// and the rename-follow that keeps the attachment pointing at the moved
// file. The only e2e over the CAS write, the agent's vault write and the
// origin rebind.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { isDefinedError, safe } from "@orpc/client";
import { contentHashHex } from "@repo/api/local/vault/vault-schema";
import { expect, expectEq } from "../harness/assert";
import type { Scenario } from "../harness/scenario";

const BASE = "# Plans\n\nfirst draft\n";
const EDITED = "# Plans\n\nsecond draft\n";
const INTRUDER = "# Plans\n\nsomeone else's save\n";
const TURN_DEADLINE_MS = 30_000;

export const actionScripted: Scenario = {
  name: "action-scripted",
  description: "an action attaches to its note; a scripted turn writes the vault; CAS + rename",
  async run(ctx) {
    const app = await ctx.boot({
      name: "solo",
      extraEnv: { INTELIGIR_AGENT: "scripted" },
    });
    const { api, vaultDir } = app;

    ctx.log("write the note and attach an action to it");
    await api.vault.write({ path: "notes/plans.md", content: BASE });
    const { thread } = await api.threads.create({
      title: "Tighten the intro",
      originDocPath: "notes/plans.md",
    });
    expectEq(thread.originDocPath, "notes/plans.md", "the action holds its note");

    ctx.log("a scripted turn on the action writes the vault through the agent path");
    const outcome = await api.threads.send({
      threadId: thread.id,
      text: "do the thing",
    });
    expect(outcome.kind === "started", `send outcome was "${outcome.kind}"`);
    const deadline = Date.now() + TURN_DEADLINE_MS;
    for (;;) {
      const { thread: current } = await api.threads.get({ threadId: thread.id });
      if (current.status === "idle") {
        break;
      }
      expect(current.status !== "error", "the turn settled in error");
      expect(Date.now() < deadline, `turn still "${current.status}" after ${TURN_DEADLINE_MS}ms`);
      await delay(250);
    }
    const agentNote = await readFile(join(vaultDir, "Agent", `${thread.id}.md`), "utf8");
    expect(agentNote.length > 0, "the scripted turn's note is on disk");

    ctx.log("a CAS write from the base lands");
    await api.vault.write({
      path: "notes/plans.md",
      content: EDITED,
      expectedHash: await contentHashHex(BASE),
    });
    expectEq(
      await readFile(join(vaultDir, "notes", "plans.md"), "utf8"),
      EDITED,
      "the guarded save landed on disk",
    );

    ctx.log("a CAS write from a STALE base answers CAS_MISMATCH with the current bytes");
    const [conflict] = await safe(
      api.vault.write({
        path: "notes/plans.md",
        content: INTRUDER,
        expectedHash: await contentHashHex(BASE),
      }),
    );
    expect(
      isDefinedError(conflict) && conflict.code === "CAS_MISMATCH",
      "the stale write was refused with the typed CAS conflict",
    );
    if (isDefinedError(conflict) && conflict.code === "CAS_MISMATCH") {
      expectEq(
        conflict.data.current?.content,
        EDITED,
        "the conflict body carries the current bytes",
      );
    }
    expectEq(
      await readFile(join(vaultDir, "notes", "plans.md"), "utf8"),
      EDITED,
      "the losing write changed nothing on disk",
    );

    ctx.log("renaming the note drags the action's attachment with it");
    await api.vault.rename({ from: "notes/plans.md", to: "notes/roadmap.md" });
    const { thread: rebound } = await api.threads.get({ threadId: thread.id });
    expectEq(rebound.originDocPath, "notes/roadmap.md", "originDocPath followed the rename");
  },
};
