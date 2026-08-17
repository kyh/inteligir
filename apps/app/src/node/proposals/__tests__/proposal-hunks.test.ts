// Per-hunk review over the composed app, with the (base, proposed) pair
// written straight into the store — the scripted driver rewrites a note
// wholesale, so a proposal with SEVERAL independent hunks has to be built
// rather than produced.
//
// What is asserted here is the property the whole per-hunk design rests on:
// each verb resolves exactly one region and leaves the others reviewable, and
// the proposal finishes when — and only when — none are left.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { captureProposal } from "@repo/db/proposals";
import { createThread } from "@repo/db/threads";
import { contentHashHex, type VaultReadResponse } from "@repo/server-contract/vault";
import { describe, expect, it } from "vitest";
import { bootTestApp, type BootedTestApp } from "../../__tests__/boot-app";

const BASE = ["# Notes", "", "alpha", "beta", "gamma"].join("\n");
const PROPOSED = ["# Notes", "", "ALPHA", "beta", "GAMMA"].join("\n");
const DOC = "Notes.md";

async function seedProposal(app: BootedTestApp): Promise<string> {
  await app.vault.service.write(DOC, BASE);
  const thread = createThread(app.db, app.bus, { writeMode: "propose" });
  const row = captureProposal(app.db, app.bus, {
    threadId: thread.id,
    docPath: DOC,
    baseHash: await contentHashHex(BASE),
    baseContent: BASE,
    proposedContent: PROPOSED,
  });
  return row.id;
}

async function readProposal(app: BootedTestApp, proposalId: string) {
  const response = await app.client.proposals.get.$get({ query: { proposalId } });
  expect(response.status).toBe(200);
  if (!response.ok) {
    throw new Error("the proposal read refused");
  }
  return (await response.json()).proposal;
}

function onDisk(app: BootedTestApp): string {
  return readFileSync(join(app.vaultDir, DOC), "utf8");
}

describe("per-hunk review", () => {
  it("derives one hunk per independent region", async () => {
    const app = await bootTestApp();
    const proposal = await readProposal(app, await seedProposal(app));
    expect(proposal.hunks.map((hunk) => hunk.proposedLines)).toEqual([["ALPHA"], ["GAMMA"]]);
    expect(proposal.status).toBe("pending");
  });

  it("accepting one hunk writes only that region and leaves the other pending", async () => {
    const app = await bootTestApp();
    const id = await seedProposal(app);
    const before = await readProposal(app, id);

    const accepted = await app.client.proposals.accept.$post({
      json: { proposalId: id, expectedRevision: before.revision, hunkIndex: 0 },
    });
    expect(accepted.status).toBe(200);

    expect(onDisk(app)).toBe(["# Notes", "", "ALPHA", "beta", "gamma"].join("\n"));
    const after = await readProposal(app, id);
    expect(after.status).toBe("pending");
    expect(after.revision).toBe(before.revision + 1);
    // The base advanced past the accepted region, so only the other one is
    // still a hunk — and it kept its proposal lines.
    expect(after.hunks).toHaveLength(1);
    expect(after.hunks[0]?.proposedLines).toEqual(["GAMMA"]);
    expect(after.baseHash).toBe(await contentHashHex(onDisk(app)));
  });

  it("rejecting one hunk touches no file and leaves the other pending", async () => {
    const app = await bootTestApp();
    const id = await seedProposal(app);
    const before = await readProposal(app, id);

    const rejected = await app.client.proposals.reject.$post({
      json: { proposalId: id, expectedRevision: before.revision, hunkIndex: 1 },
    });
    expect(rejected.status).toBe(200);

    expect(onDisk(app)).toBe(BASE);
    const after = await readProposal(app, id);
    expect(after.status).toBe("pending");
    expect(after.hunks).toHaveLength(1);
    expect(after.hunks[0]?.proposedLines).toEqual(["ALPHA"]);
  });

  it("finishes as ACCEPTED once the last hunk lands", async () => {
    const app = await bootTestApp();
    const id = await seedProposal(app);
    for (const hunkIndex of [0, 0]) {
      const current = await readProposal(app, id);
      const response = await app.client.proposals.accept.$post({
        json: { proposalId: id, expectedRevision: current.revision, hunkIndex },
      });
      expect(response.status).toBe(200);
    }
    expect(onDisk(app)).toBe(PROPOSED);
    expect((await readProposal(app, id)).status).toBe("accepted");
  });

  it("finishes as REJECTED once the last hunk is discarded", async () => {
    const app = await bootTestApp();
    const id = await seedProposal(app);
    for (const hunkIndex of [0, 0]) {
      const current = await readProposal(app, id);
      const response = await app.client.proposals.reject.$post({
        json: { proposalId: id, expectedRevision: current.revision, hunkIndex },
      });
      expect(response.status).toBe(200);
    }
    expect(onDisk(app)).toBe(BASE);
    expect((await readProposal(app, id)).status).toBe("rejected");
  });

  it("mixes the two: accept one, reject the other, and the file holds exactly that", async () => {
    const app = await bootTestApp();
    const id = await seedProposal(app);

    const first = await readProposal(app, id);
    expect(
      (
        await app.client.proposals.accept.$post({
          json: { proposalId: id, expectedRevision: first.revision, hunkIndex: 0 },
        })
      ).status,
    ).toBe(200);
    const second = await readProposal(app, id);
    expect(
      (
        await app.client.proposals.reject.$post({
          json: { proposalId: id, expectedRevision: second.revision, hunkIndex: 0 },
        })
      ).status,
    ).toBe(200);

    expect(onDisk(app)).toBe(["# Notes", "", "ALPHA", "beta", "gamma"].join("\n"));
    // The LAST verb was a reject, and the outcome is still an acceptance:
    // the status reports what reached the file, so a history that said
    // "rejected" here would contradict the note it describes.
    const settled = await readProposal(app, id);
    expect(settled.status).toBe("accepted");
    expect(settled.acceptedHunks).toBe(1);
  });

  it("refuses a hunk index derived from a revision that already moved", async () => {
    const app = await bootTestApp();
    const id = await seedProposal(app);
    const stale = await readProposal(app, id);
    await app.client.proposals.accept.$post({
      json: { proposalId: id, expectedRevision: stale.revision, hunkIndex: 0 },
    });

    const refused = await app.client.proposals.accept.$post({
      json: { proposalId: id, expectedRevision: stale.revision, hunkIndex: 1 },
    });
    expect(refused.status).toBe(409);
    if (refused.ok) return;
    expect(await refused.json()).toMatchObject({ error: "conflict" });
  });

  it("refuses a per-hunk accept against changed disk, without touching the file", async () => {
    const app = await bootTestApp();
    const id = await seedProposal(app);
    const proposal = await readProposal(app, id);
    const meanwhile = ["# Notes", "", "the user rewrote all of this"].join("\n");
    await app.vault.service.write(DOC, meanwhile);

    const refused = await app.client.proposals.accept.$post({
      json: { proposalId: id, expectedRevision: proposal.revision, hunkIndex: 0 },
    });
    expect(refused.status).toBe(409);
    if (refused.ok) return;
    expect(await refused.json()).toMatchObject({ error: "cas_mismatch" });
    expect(onDisk(app)).toBe(meanwhile);
    // Still reviewable — and the read says why it cannot be applied.
    expect((await readProposal(app, id)).status).toBe("stale");
  });

  it("reads the accepted file back through the vault route, unchanged", async () => {
    const app = await bootTestApp();
    const id = await seedProposal(app);
    const proposal = await readProposal(app, id);
    await app.client.proposals.accept.$post({
      json: { proposalId: id, expectedRevision: proposal.revision },
    });
    const read = await app.client.vault.file.$get({ query: { path: DOC } });
    expect(read.status).toBe(200);
    if (!read.ok) return;
    const body: VaultReadResponse = await read.json();
    expect(body.content).toBe(PROPOSED);
  });
});
