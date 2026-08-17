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
import { insertThreadMarker } from "@repo/notes/markdown/thread-marker";
import type { ApiClient } from "@repo/server-contract/client";
import { expect, expectEq } from "../harness/assert";
import { exec, hermeticProcessEnv } from "../harness/exec";
import type { Scenario } from "../harness/scenario";

const DOC_PATH = "Plans.md";
const DOC = `# Plans

First paragraph to delegate.
`;
const ANCHOR = "anc_0e2e0d1e5e11";
const PROMPT = "Rewrite the paragraph";
const BASE_NOTE = "# Agent note\n\nthe line that was already here\n";
const TURN_DEADLINE_MS = 30_000;

async function settled(api: ApiClient, threadId: string): Promise<void> {
  const deadline = Date.now() + TURN_DEADLINE_MS;
  for (;;) {
    const detail = await api.threads.get.$get({ query: { threadId } });
    expect(detail.status === 200, `thread get answered ${detail.status}`);
    if (!detail.ok) {
      return;
    }
    const { thread } = await detail.json();
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
    const seeded = await app.api.vault.file.$put({
      json: { path: DOC_PATH, content: DOC, ifAbsent: true },
    });
    expect(seeded.status === 200, `seed write answered ${seeded.status}`);
    const anchored = await app.api.vault.file.$put({
      json: { path: DOC_PATH, content: insertThreadMarker(DOC, DOC.indexOf("paragraph"), ANCHOR) },
    });
    expect(anchored.status === 200, `anchor write answered ${anchored.status}`);

    ctx.log("create the delegation in REVIEW mode");
    const created = await app.api.threads.create.$post({
      json: {
        title: PROMPT,
        originDocPath: DOC_PATH,
        originAnchor: ANCHOR,
        writeMode: "propose",
      },
    });
    expect(created.status === 201, `create answered ${created.status}`);
    const { thread } = await created.json();
    expectEq(thread.writeMode, "propose", "the thread's write mode");

    // The file the scripted turn rewrites. Seeded first so the capture is a
    // MODIFICATION — the case with a base hash, hunks and a real CAS.
    const notePath = `Agent/${thread.id}.md`;
    const seedNote = await app.api.vault.file.$put({
      json: { path: notePath, content: BASE_NOTE, ifAbsent: true },
    });
    expect(seedNote.status === 200, `note seed answered ${seedNote.status}`);

    ctx.log("run the turn");
    const send = await app.api.threads.send.$post({
      json: { threadId: thread.id, text: PROMPT, mode: "steer-if-active" },
    });
    expect(send.status === 200, `send answered ${send.status}`);
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
    const listed = await app.api.proposals.list.$get({ query: { docPath: notePath } });
    expect(listed.status === 200, `proposals list answered ${listed.status}`);
    const { proposals } = await listed.json();
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
    const pendingChip = await app.api.threads["by-doc"].$get({ query: { docPath: DOC_PATH } });
    expect(pendingChip.status === 200, `by-doc answered ${pendingChip.status}`);
    const pendingRows = (await pendingChip.json()).threads;
    expectEq(pendingRows.length, 1, "one bound thread");
    expectEq(pendingRows[0]?.thread.status, "idle", "the turn is over");
    expectEq(pendingRows[0]?.pendingProposalCount, 1, "the chip's suggestion count");

    ctx.log("a stale accept is refused rather than applied");
    const meanwhile = "# Agent note\n\nthe user rewrote this\n";
    const userWrite = await app.api.vault.file.$put({
      json: { path: notePath, content: meanwhile },
    });
    expect(userWrite.status === 200, `user write answered ${userWrite.status}`);
    const refused = await app.api.proposals.accept.$post({
      json: { proposalId: proposal.id, expectedRevision: proposal.revision },
    });
    expectEq(refused.status, 409, "accepting against changed disk");
    expectEq(
      await readFile(join(app.vaultDir, notePath), "utf8"),
      meanwhile,
      "the user's bytes after the refusal",
    );
    // The read says WHY, so the UI can offer a re-run rather than a retry.
    const afterRefusal = await app.api.proposals.list.$get({ query: { docPath: notePath } });
    expect(afterRefusal.status === 200, `proposals list answered ${afterRefusal.status}`);
    expectEq((await afterRefusal.json()).proposals[0]?.status, "stale", "status after the refusal");

    ctx.log("restore the base, then accept for real");
    const restore = await app.api.vault.file.$put({
      json: { path: notePath, content: BASE_NOTE },
    });
    expect(restore.status === 200, `restore answered ${restore.status}`);
    const accepted = await app.api.proposals.accept.$post({
      json: { proposalId: proposal.id, expectedRevision: proposal.revision },
    });
    expect(accepted.status === 200, `accept answered ${accepted.status}`);

    ctx.log("the bytes are on disk and the queue is empty");
    const onDisk = await readFile(join(app.vaultDir, notePath), "utf8");
    expectEq(onDisk, proposal.proposedContent, "the accepted bytes");
    expect(onDisk.includes(PROMPT), "the accepted file holds the agent's text");
    const drained = await app.api.proposals.list.$get({ query: { docPath: notePath } });
    expect(drained.status === 200, `proposals list answered ${drained.status}`);
    expectEq((await drained.json()).proposals.length, 0, "suggestions left to review");

    ctx.log("the chip settles");
    const settledChip = await app.api.threads["by-doc"].$get({ query: { docPath: DOC_PATH } });
    expect(settledChip.status === 200, `by-doc answered ${settledChip.status}`);
    const settledRows = (await settledChip.json()).threads;
    expectEq(settledRows[0]?.pendingProposalCount, 0, "the chip's suggestion count after accept");
    expectEq(settledRows[0]?.openInteractionCount, 0, "no open approvals");
    expectEq(settledRows[0]?.queuedCount, 0, "no queued sends");

    ctx.log("a REJECT leaves the tree untouched");
    const second = await app.api.threads.send.$post({
      json: { threadId: thread.id, text: "another pass", mode: "steer-if-active" },
    });
    expect(second.status === 200, `second send answered ${second.status}`);
    await settled(app.api, thread.id);
    const before = await readFile(join(app.vaultDir, notePath), "utf8");
    const secondListing = await app.api.proposals.list.$get({ query: { docPath: notePath } });
    expect(secondListing.status === 200, `proposals list answered ${secondListing.status}`);
    const secondProposal = (await secondListing.json()).proposals[0];
    expect(secondProposal !== undefined, "the second turn produced a suggestion");
    if (secondProposal === undefined) return;
    const rejected = await app.api.proposals.reject.$post({
      json: { proposalId: secondProposal.id, expectedRevision: secondProposal.revision },
    });
    expect(rejected.status === 200, `reject answered ${rejected.status}`);
    expectEq(await readFile(join(app.vaultDir, notePath), "utf8"), before, "the file after reject");

    ctx.log("a DIRECT-mode delegation still writes, unchanged by any of this");
    const directThread = await app.api.threads.create.$post({
      json: { title: "direct", originDocPath: DOC_PATH, originAnchor: "anc_0e2e0d1e5e22" },
    });
    expect(directThread.status === 201, `direct create answered ${directThread.status}`);
    const direct = (await directThread.json()).thread;
    expectEq(direct.writeMode, "direct", "the default write mode");
    const directSend = await app.api.threads.send.$post({
      json: { threadId: direct.id, text: "land this", mode: "steer-if-active" },
    });
    expect(directSend.status === 200, `direct send answered ${directSend.status}`);
    await settled(app.api, direct.id);
    const directNote = await readFile(join(app.vaultDir, `Agent/${direct.id}.md`), "utf8");
    expect(directNote.includes("land this"), "the direct turn's write landed on disk");
  },
};
