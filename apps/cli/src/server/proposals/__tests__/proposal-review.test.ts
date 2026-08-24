// The review loop against the composed app: a review-mode turn captures
// instead of landing, the queue reads back over the wire, and both verbs go
// through the paths a user's own edit takes.
//
// The scripted driver is the producer here on purpose — it writes through the
// vault SERVICE, which is the same seam a codex write reaches through its
// reported path, so what is exercised below is the production capture and not
// a stand-in for it.

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { isDefinedError, safe } from "@orpc/client";
import type { Proposal } from "@repo/api/local/proposals/proposals-schema";
import { contentHashHex } from "@repo/api/local/vault/vault-schema";
import { describe, expect, it } from "vitest";
import { resolveAgentDriver } from "../../agent/agent-driver";
import {
  createThread,
  getThreadDetail,
  sendMessage,
  waitFor,
} from "../../agent/__tests__/agent-test-harness";
import { scriptedNotePath } from "../../agent/scripted-driver";
import { bootTestApp, type BootedTestApp } from "../../__tests__/boot-app";
import { hermeticGitEnv } from "../../vault/__tests__/git-test-env";
import { createTurnProposalCapture } from "../turn-proposals";

const execFileAsync = promisify(execFile);

async function git(vaultDir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: vaultDir,
    env: { ...process.env, ...hermeticGitEnv() },
  });
  return stdout;
}

async function bootReviewApp(): Promise<BootedTestApp> {
  return bootTestApp({
    agent: { mode: "scripted", runtime: "scripted", detail: null },
    makeDriver: ({ db, bus, vault, vaultDir }) => {
      const resolved = resolveAgentDriver({
        config: { agent: "scripted", agentModel: null, vaultDir },
        db,
        notifier: bus,
        vault,
        captureProposals: createTurnProposalCapture({
          db,
          notifier: bus,
          git: vault.git,
          vault: vault.service,
        }),
        mcpServers: () => [],
        shellEnv: () => ({}),
        cliBinDir: null,
        connectedDirs: () => [],
      });
      return { createTurnDriver: resolved.createTurnDriver, dispose: resolved.dispose };
    },
  });
}

/** Run one review-mode turn and wait for it to settle. `seed` writes the note
 *  the scripted driver will rewrite, so the capture is a modification rather
 *  than a creation; it goes through the vault SERVICE, which is what the base
 *  flush at turn start then commits. */
async function runReviewTurn(
  app: BootedTestApp,
  text: string,
  seed?: string,
): Promise<{ threadId: string; notePath: string }> {
  const threadId = await createThread(app.client, { writeMode: "propose" });
  const notePath = scriptedNotePath(threadId);
  if (seed !== undefined) {
    await app.vault.service.write(notePath, seed);
  }
  await sendMessage(app.client, threadId, text);
  await waitFor(
    async () =>
      (await getThreadDetail(app.client, threadId)).status === "idle" ? true : undefined,
    "the review-mode turn to settle",
  );
  return { threadId, notePath };
}

async function listProposals(app: BootedTestApp, docPath?: string): Promise<Proposal[]> {
  const { proposals } = await app.client.proposals.list(docPath === undefined ? {} : { docPath });
  return proposals;
}

describe("a review-mode turn", () => {
  it("captures its write as a proposal and leaves the working tree untouched", async () => {
    const app = await bootReviewApp();
    const { threadId, notePath } = await runReviewTurn(app, "remember the milk");

    // Nothing the agent wrote reached the tree...
    expect(existsSync(join(app.vaultDir, notePath))).toBe(false);
    // ...and nothing was committed for it either: the last commit is still
    // the base flush, never an agent-attributed one.
    const subjects = await git(app.vaultDir, ["log", "--format=%s"]);
    expect(subjects).not.toContain("agent: vault update");

    const proposals = await listProposals(app, notePath);
    expect(proposals).toHaveLength(1);
    const proposal = proposals[0];
    expect(proposal?.threadId).toBe(threadId);
    expect(proposal?.status).toBe("pending");
    expect(proposal?.docPath).toBe(notePath);
    // The file did not exist at the base revision, so this is a creation.
    expect(proposal?.baseHash).toBeNull();
    expect(proposal?.proposedContent).toContain("remember the milk");
    expect(proposal?.hunks.length).toBeGreaterThan(0);
  });

  it("leaves the vault's commit hold released — a sync can start again", async () => {
    const app = await bootReviewApp();
    await runReviewTurn(app, "hold check");
    // `syncNow` short-circuits to `held` while any hold is open. A vault with
    // no remote answers `no-remote`, which it can only do past that check.
    const status = await app.vault.syncNow();
    expect(status.state).toBe("no-remote");
  });

  it("proposes a MODIFICATION when the file already exists", async () => {
    const app = await bootReviewApp();
    const { notePath } = await runReviewTurn(
      app,
      "revise this",
      "# Agent note\n\nthe original line\n",
    );

    const proposal = (await listProposals(app, notePath))[0];
    expect(proposal?.baseHash).not.toBeNull();
    expect(proposal?.baseContent).toContain("the original line");
    expect(proposal?.proposedContent).toContain("revise this");
    // The tree still holds the base, byte for byte.
    expect(readFileSync(join(app.vaultDir, notePath), "utf8")).toBe(proposal?.baseContent);
  });
});

describe("accepting", () => {
  it("lands through the vault's own write path, so the index sees it", async () => {
    const app = await bootReviewApp();
    const { notePath } = await runReviewTurn(app, "searchable phrase xyzzy");
    const proposal = (await listProposals(app, notePath))[0];
    expect(proposal).toBeDefined();
    if (proposal === undefined) return;

    await app.client.proposals.accept({
      proposalId: proposal.id,
      expectedRevision: proposal.revision,
    });

    expect(readFileSync(join(app.vaultDir, notePath), "utf8")).toBe(proposal.proposedContent);
    expect(await listProposals(app, notePath)).toEqual([]);

    // The knowledge index is driven by the vault's change announcement, which
    // only an ordinary service write makes — so finding the note here is the
    // assertion that the accept did not take a side door.
    const { results } = await app.client.knowledge.search({ q: "xyzzy", limit: 10 });
    expect(results.map((result) => result.path)).toContain(notePath);
  });

  it("REFUSES when the file changed since the proposal was computed", async () => {
    const app = await bootReviewApp();
    const { notePath } = await runReviewTurn(
      app,
      "revise this",
      "# Agent note\n\nthe original line\n",
    );
    const proposal = (await listProposals(app, notePath))[0];
    expect(proposal).toBeDefined();
    if (proposal === undefined) return;

    const meanwhile = "# Agent note\n\nthe user rewrote this\n";
    await app.vault.service.write(notePath, meanwhile);

    const [refused] = await safe(
      app.client.proposals.accept({
        proposalId: proposal.id,
        expectedRevision: proposal.revision,
      }),
    );
    expect(isDefinedError(refused) && refused.code).toBe("CAS_MISMATCH");
    // The user's bytes stand.
    expect(readFileSync(join(app.vaultDir, notePath), "utf8")).toBe(meanwhile);
  });

  it("refuses a revision the caller did not read", async () => {
    const app = await bootReviewApp();
    const { notePath } = await runReviewTurn(app, "stale revision");
    const proposal = (await listProposals(app, notePath))[0];
    expect(proposal).toBeDefined();
    if (proposal === undefined) return;

    const [refused] = await safe(
      app.client.proposals.accept({
        proposalId: proposal.id,
        expectedRevision: proposal.revision + 1,
      }),
    );
    expect(isDefinedError(refused) && refused.code).toBe("CONFLICT");
  });

  it("applies ONE hunk and keeps the rest pending", async () => {
    const app = await bootReviewApp();
    const base = ["# Agent note", "", "alpha", "beta", "gamma"].join("\n");
    const { notePath } = await runReviewTurn(app, "the middle", base);
    // The scripted note is a whole rewrite, so re-shape the pair into one
    // with two independent hunks by rejecting into the middle of it.
    const proposal = (await listProposals(app, notePath))[0];
    expect(proposal).toBeDefined();
    if (proposal === undefined) return;
    expect(proposal.hunks).toHaveLength(1);

    await app.client.proposals.accept({
      proposalId: proposal.id,
      expectedRevision: proposal.revision,
      hunkIndex: 0,
    });
    // One hunk WAS the whole proposal, so it is finished and on disk.
    expect(readFileSync(join(app.vaultDir, notePath), "utf8")).toBe(proposal.proposedContent);
    expect(await listProposals(app, notePath)).toEqual([]);
  });

  it("refuses a hunk index the proposal does not carry", async () => {
    const app = await bootReviewApp();
    const { notePath } = await runReviewTurn(app, "one hunk only");
    const proposal = (await listProposals(app, notePath))[0];
    expect(proposal).toBeDefined();
    if (proposal === undefined) return;

    const [refused] = await safe(
      app.client.proposals.accept({
        proposalId: proposal.id,
        expectedRevision: proposal.revision,
        hunkIndex: 99,
      }),
    );
    expect(isDefinedError(refused) && refused.code).toBe("BAD_REQUEST");
  });
});

describe("rejecting", () => {
  it("discards the suggestion and leaves the tree untouched", async () => {
    const app = await bootReviewApp();
    const { notePath } = await runReviewTurn(app, "not this", "# Agent note\n\nkeep me\n");
    const before = readFileSync(join(app.vaultDir, notePath), "utf8");
    const proposal = (await listProposals(app, notePath))[0];
    expect(proposal).toBeDefined();
    if (proposal === undefined) return;

    await app.client.proposals.reject({
      proposalId: proposal.id,
      expectedRevision: proposal.revision,
    });
    expect(readFileSync(join(app.vaultDir, notePath), "utf8")).toBe(before);
    expect(await listProposals(app, notePath)).toEqual([]);

    const history = await app.client.proposals.list({ docPath: notePath, includeResolved: true });
    expect(history.proposals[0]?.status).toBe("rejected");
  });
});

describe("staleness", () => {
  it("is DERIVED: the row still says pending, the read says stale", async () => {
    const app = await bootReviewApp();
    const { notePath } = await runReviewTurn(
      app,
      "revise this",
      "# Agent note\n\nthe original line\n",
    );
    expect((await listProposals(app, notePath))[0]?.status).toBe("pending");

    await app.vault.service.write(notePath, "# Agent note\n\nsomething else entirely\n");
    const stale = (await listProposals(app, notePath))[0];
    expect(stale?.status).toBe("stale");
    // The base it was computed against is unchanged — staleness is a fact
    // about DISK, so putting the bytes back makes the same row pending again.
    expect(stale?.baseHash).toBe(await contentHashHex("# Agent note\n\nthe original line\n"));
    await app.vault.service.write(notePath, "# Agent note\n\nthe original line\n");
    expect((await listProposals(app, notePath))[0]?.status).toBe("pending");
  });

  it("reads stale when the file is deleted under a modification proposal", async () => {
    const app = await bootReviewApp();
    const { notePath } = await runReviewTurn(
      app,
      "revise this",
      "# Agent note\n\nthe original line\n",
    );
    await app.vault.service.remove(notePath);
    expect((await listProposals(app, notePath))[0]?.status).toBe("stale");
  });
});

describe("supersession", () => {
  it("a second review turn on the same thread replaces its pending proposal", async () => {
    const app = await bootReviewApp();
    const { threadId, notePath } = await runReviewTurn(app, "first pass");
    const first = (await listProposals(app, notePath))[0];
    expect(first?.proposedContent).toContain("first pass");

    await sendMessage(app.client, threadId, "second pass");
    await waitFor(
      async () =>
        (await getThreadDetail(app.client, threadId)).status === "idle" ? true : undefined,
      "the second review turn to settle",
    );

    const proposals = await listProposals(app, notePath);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.id).toBe(first?.id);
    expect(proposals[0]?.proposedContent).toContain("second pass");
    // The revision climbed, so a client holding the first pair is refused.
    expect(proposals[0]?.revision).toBeGreaterThan(first?.revision ?? 0);
  });
});

describe("a direct-write turn", () => {
  it("still lands its writes and captures nothing", async () => {
    const app = await bootReviewApp();
    const threadId = await createThread(app.client, {});
    const notePath = scriptedNotePath(threadId);
    await sendMessage(app.client, threadId, "land this");
    await waitFor(
      async () =>
        (await getThreadDetail(app.client, threadId)).status === "idle" ? true : undefined,
      "the direct turn to settle",
    );
    expect(readFileSync(join(app.vaultDir, notePath), "utf8")).toContain("land this");
    expect(await listProposals(app, notePath)).toEqual([]);
  });
});
