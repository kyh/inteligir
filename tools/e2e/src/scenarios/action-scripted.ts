import { readFile } from "node:fs/promises";
import path from "node:path";
import { isDefinedError, safe } from "@orpc/client";
import { contentHashHex } from "@repo/api/local/vault/vault-schema";
import { expect, expectEq } from "../harness/assert";
import type { Scenario } from "../harness/scenario";
import { untilThreadIdle } from "../harness/threads";

const BASE = "# Plans\n\nfirst draft\n";
// the id an action binds by, minted into a note that has none
const MINTED_ID = /^---\nid: [\w-]+\n---\n/u;

export const actionScripted: Scenario = {
  description: "an action attaches to its note; a scripted turn writes the vault; CAS + rename",
  name: "action-scripted",
  async run(ctx) {
    const app = await ctx.boot({
      extraEnv: { INTELIGIR_AGENT: "scripted" },
      name: "solo",
    });
    const { api, vaultDir } = app;

    ctx.log("write the note and attach an action to it");
    await api.vault.write({ content: BASE, guard: { kind: "overwrite" }, path: "notes/plans.md" });
    const { thread } = await api.threads.create({
      originDocPath: "notes/plans.md",
      title: "Tighten the intro",
    });
    expectEq(thread.originDocPath, "notes/plans.md", "the action holds its note");
    const minted = await readFile(path.join(vaultDir, "notes", "plans.md"), "utf-8");
    expect(
      MINTED_ID.test(minted) && minted.endsWith(BASE),
      `the action gave its note an id and nothing else:\n${minted}`,
    );
    const edited = minted.replace("first draft", "second draft");

    ctx.log("a scripted turn on the action writes the vault through the agent path");
    const outcome = await api.threads.send({
      text: "do the thing",
      threadId: thread.id,
    });
    expect(outcome.kind === "started", `send outcome was "${outcome.kind}"`);
    await untilThreadIdle(api, thread.id);
    const agentNote = await readFile(path.join(vaultDir, "Agent", `${thread.id}.md`), "utf-8");
    expect(agentNote.length > 0, "the scripted turn's note is on disk");

    ctx.log("a CAS write from the base lands");
    await api.vault.write({
      content: edited,
      guard: { hash: await contentHashHex(minted), kind: "expected" },
      path: "notes/plans.md",
    });
    expectEq(
      await readFile(path.join(vaultDir, "notes", "plans.md"), "utf-8"),
      edited,
      "the guarded save landed on disk",
    );

    ctx.log("a CAS write from a STALE base answers CAS_MISMATCH with the current bytes");
    const [conflict] = await safe(
      api.vault.write({
        content: minted.replace("first draft", "someone else's save"),
        guard: { hash: await contentHashHex(minted), kind: "expected" },
        path: "notes/plans.md",
      }),
    );
    expect(
      isDefinedError(conflict) && conflict.code === "CAS_MISMATCH",
      "the stale write was refused with the typed CAS conflict",
    );
    if (isDefinedError(conflict) && conflict.code === "CAS_MISMATCH") {
      expectEq(
        conflict.data.current?.content,
        edited,
        "the conflict body carries the current bytes",
      );
    }
    expectEq(
      await readFile(path.join(vaultDir, "notes", "plans.md"), "utf-8"),
      edited,
      "the losing write changed nothing on disk",
    );

    ctx.log("renaming the note drags the action's attachment with it");
    await api.vault.rename({ from: "notes/plans.md", to: "notes/roadmap.md" });
    const { thread: rebound } = await api.threads.get({ threadId: thread.id });
    expectEq(rebound.originDocPath, "notes/roadmap.md", "originDocPath followed the rename");
  },
};
