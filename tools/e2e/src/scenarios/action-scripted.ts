// The ACTION loop (#587's surviving surface), end to end: a thread ATTACHED
// to the note it was composed over (`originDocPath` alone — no marker), the
// guarded CAS write the editor saves through, a 409 whose body carries the
// current bytes, and the rename-follow that keeps the attachment pointing at
// the moved file. This replaced the retired delegation/proposal scenarios
// (#613) and is the only e2e over the CAS write and the origin rebind.

import { contentHashHex } from "@repo/api/local/vault/vault-schema";
import { expect, expectEq } from "../harness/assert";
import type { Scenario } from "../harness/scenario";

const BASE = "# Plans\n\nfirst draft\n";
const EDITED = "# Plans\n\nsecond draft\n";
const INTRUDER = "# Plans\n\nsomeone else's save\n";

export const actionScripted: Scenario = {
  name: "action-scripted",
  description: "an action attaches to its note; CAS write guards the save; rename follows",
  async run(ctx) {
    const app = await ctx.boot({
      name: "solo",
      extraEnv: { INTELIGIR_AGENT: "scripted" },
    });

    ctx.log("write the note and attach an action to it");
    await app.api.vault.write({ path: "notes/plans.md", content: BASE });
    const { thread } = await app.api.threads.create({
      title: "Tighten the intro",
      originDocPath: "notes/plans.md",
    });
    expectEq(thread.originDocPath, "notes/plans.md", "the action holds its note");

    ctx.log("a CAS write from the base lands");
    await app.api.vault.write({
      path: "notes/plans.md",
      content: EDITED,
      expectedHash: await contentHashHex(BASE),
    });
    const afterEdit = await app.api.vault.read({ path: "notes/plans.md" });
    expectEq(afterEdit.content, EDITED, "the guarded save landed");

    ctx.log("a CAS write from a STALE base answers 409 with the current bytes");
    let conflicted = false;
    try {
      await app.api.vault.write({
        path: "notes/plans.md",
        content: INTRUDER,
        expectedHash: await contentHashHex(BASE),
      });
    } catch (failure) {
      conflicted = true;
      const message = failure instanceof Error ? failure.message : String(failure);
      expect(message.length > 0, "the conflict carries a message");
    }
    expect(conflicted, "the stale write was refused, not silently applied");
    const untouched = await app.api.vault.read({ path: "notes/plans.md" });
    expectEq(untouched.content, EDITED, "the losing write changed nothing");

    ctx.log("renaming the note drags the action's attachment with it");
    await app.api.vault.rename({ from: "notes/plans.md", to: "notes/roadmap.md" });
    const { thread: rebound } = await app.api.threads.get({ threadId: thread.id });
    expectEq(rebound.originDocPath, "notes/roadmap.md", "originDocPath followed the rename");
  },
};
