// The review layer end to end under the scripted driver: delegate in review
// mode, watch the turn finish WITHOUT touching the file, find the suggestion,
// accept it, and see the bytes land and the doc's chip settle.
//
// The assertion that carries the scenario is the negative one in the middle.
// A review-mode turn that quietly wrote the file would pass every other check
// here — the proposal row would exist, the accept would be a no-op write, the
// chip would settle — so the working tree and the git log are inspected while
// the suggestion is still pending, before anything applies it.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { isDefinedError, safe } from "@orpc/client";
import { insertThreadMarker } from "@repo/notes/markdown/thread-marker";
import { expect, expectEq } from "../harness/assert";
import { exec, hermeticProcessEnv } from "../harness/exec";
import type { InstanceApi } from "../harness/instance";
import type { Scenario } from "../harness/scenario";

const DOC_PATH = "Plans.md";
const DOC = `# Plans

First paragraph to delegate.
`;
const ANCHOR = "anc_0e2e0d1e5e11";
const PROMPT = "Rewrite the paragraph";
const BASE_NOTE = "# Agent note\n\nthe line that was already here\n";
const TURN_DEADLINE_MS = 30_000;

async function settled(api: InstanceApi, threadId: string): Promise<void> {
  const deadline = Date.now() + TURN_DEADLINE_MS;
  for (;;) {
    const { thread } = await api.threads.get({ threadId });
    if (thread.status === "idle") {
      return;
    }
    expect(thread.status !== "error", "the turn settled in error");
    expect(Date.now() < deadline, `turn still "${thread.status}" after ${TURN_DEADLINE_MS}ms`);
    await delay(250);
  }
}

export const proposalReview: Scenario = {
  name: "proposal-review",
  description:
    "a review-mode delegation proposes instead of writing; accepting lands the bytes and settles the chip",
  async run(ctx) {
    const app = await ctx.boot({
      name: "solo",
      extraEnv: { INTELIGIR_AGENT: "scripted" },
    });

    ctx.log("anchor the doc, as the production order requires");
    await app.api.vault.write({ path: DOC_PATH, content: DOC, ifAbsent: true });
    await app.api.vault.write({
      path: DOC_PATH,
      content: insertThreadMarker(DOC, DOC.indexOf("paragraph"), ANCHOR),
    });

    ctx.log("create the delegation in REVIEW mode");
    const { thread } = await app.api.threads.create({
      title: PROMPT,
      originDocPath: DOC_PATH,
      originAnchor: ANCHOR,
      writeMode: "propose",
    });
    expectEq(thread.writeMode, "propose", "the thread's write mode");

    // The file the scripted turn rewrites. Seeded first so the capture is a
    // MODIFICATION — the case with a base hash, hunks and a real CAS.
    const notePath = `Agent/${thread.id}.md`;
    await app.api.vault.write({ path: notePath, content: BASE_NOTE, ifAbsent: true });

    ctx.log("run the turn");
    await app.api.threads.send({ threadId: thread.id, text: PROMPT, mode: "steer-if-active" });
    await settled(app.api, thread.id);

    ctx.log("NOTHING reached the working tree, and nothing was committed for it");
    expectEq(await readFile(join(app.vaultDir, notePath), "utf8"), BASE_NOTE, "the file on disk");
    const log = await exec("git", ["log", "--format=%s"], {
      cwd: app.vaultDir,
      env: hermeticProcessEnv(),
    });
    expect(
      !log.stdout.includes("agent: vault update"),
      `a review-mode turn made an agent commit:\n${log.stdout}`,
    );

    ctx.log("the suggestion is on the review queue, against this doc");
    const { proposals } = await app.api.proposals.list({ docPath: notePath });
    expectEq(proposals.length, 1, "pending suggestions for the note");
    const proposal = proposals[0];
    expect(proposal !== undefined, "the suggestion is present");
    if (proposal === undefined) return;
    expectEq(proposal.status, "pending", "suggestion status");
    expectEq(proposal.threadId, thread.id, "the suggestion's thread");
    expectEq(proposal.baseContent, BASE_NOTE, "the base it was computed against");
    expect(proposal.hunks.length > 0, "the suggestion carries at least one hunk");
    expect(
      proposal.proposedContent?.includes(PROMPT) === true,
      "the suggestion holds what the agent wrote",
    );

    ctx.log("the doc's chip reads needs-review while it is pending");
    const pendingRows = (await app.api.threads.byDoc({ docPath: DOC_PATH })).threads;
    expectEq(pendingRows.length, 1, "one bound thread");
    expectEq(pendingRows[0]?.thread.status, "idle", "the turn is over");
    expectEq(pendingRows[0]?.pendingProposalCount, 1, "the chip's suggestion count");

    ctx.log("a stale accept is refused rather than applied");
    const meanwhile = "# Agent note\n\nthe user rewrote this\n";
    await app.api.vault.write({ path: notePath, content: meanwhile });
    const [refused] = await safe(
      app.api.proposals.accept({ proposalId: proposal.id, expectedRevision: proposal.revision }),
    );
    expect(
      isDefinedError(refused) && refused.code === "CAS_MISMATCH",
      "accepting against changed disk",
    );
    expectEq(
      await readFile(join(app.vaultDir, notePath), "utf8"),
      meanwhile,
      "the user's bytes after the refusal",
    );
    // The read says WHY, so the UI can offer a re-run rather than a retry.
    const afterRefusal = await app.api.proposals.list({ docPath: notePath });
    expectEq(afterRefusal.proposals[0]?.status, "stale", "status after the refusal");

    ctx.log("restore the base, then accept for real");
    await app.api.vault.write({ path: notePath, content: BASE_NOTE });
    await app.api.proposals.accept({
      proposalId: proposal.id,
      expectedRevision: proposal.revision,
    });

    ctx.log("the bytes are on disk and the queue is empty");
    const onDisk = await readFile(join(app.vaultDir, notePath), "utf8");
    expectEq(onDisk, proposal.proposedContent, "the accepted bytes");
    expect(onDisk.includes(PROMPT), "the accepted file holds the agent's text");
    const drained = await app.api.proposals.list({ docPath: notePath });
    expectEq(drained.proposals.length, 0, "suggestions left to review");

    ctx.log("the chip settles");
    const settledRows = (await app.api.threads.byDoc({ docPath: DOC_PATH })).threads;
    expectEq(settledRows[0]?.pendingProposalCount, 0, "the chip's suggestion count after accept");
    expectEq(settledRows[0]?.openInteractionCount, 0, "no open approvals");
    expectEq(settledRows[0]?.queuedCount, 0, "no queued sends");

    ctx.log("a REJECT leaves the tree untouched");
    await app.api.threads.send({
      threadId: thread.id,
      text: "another pass",
      mode: "steer-if-active",
    });
    await settled(app.api, thread.id);
    const before = await readFile(join(app.vaultDir, notePath), "utf8");
    const secondListing = await app.api.proposals.list({ docPath: notePath });
    const secondProposal = secondListing.proposals[0];
    expect(secondProposal !== undefined, "the second turn produced a suggestion");
    if (secondProposal === undefined) return;
    await app.api.proposals.reject({
      proposalId: secondProposal.id,
      expectedRevision: secondProposal.revision,
    });
    expectEq(await readFile(join(app.vaultDir, notePath), "utf8"), before, "the file after reject");

    ctx.log("a DIRECT-mode delegation still writes, unchanged by any of this");
    const direct = (
      await app.api.threads.create({
        title: "direct",
        originDocPath: DOC_PATH,
        originAnchor: "anc_0e2e0d1e5e22",
      })
    ).thread;
    expectEq(direct.writeMode, "direct", "the default write mode");
    await app.api.threads.send({ threadId: direct.id, text: "land this", mode: "steer-if-active" });
    await settled(app.api, direct.id);
    const directNote = await readFile(join(app.vaultDir, `Agent/${direct.id}.md`), "utf8");
    expect(directNote.includes("land this"), "the direct turn's write landed on disk");
  },
};
