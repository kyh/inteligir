// ---------------------------------------------------------------------------
// What the container does with the object's answer to a vault report.
//
// The agent's own `write`/`edit`/`bash` already told the model "done" — against
// a COPY. Everything about whether the user actually has the file is in this
// reply, so a daemon that posts it and moves on leaves the model building on
// notes that do not exist. These cases are the two halves of reading it: what
// the model is told, and which revision the container may then claim.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import type { AgentReport, AgentReportReply, VaultOp } from "../protocol";
import { createVaultReport, readVaultReply } from "../vault-report";

const WROTE: VaultOp[] = [
  { op: "upsert", path: "notes/a.md", bytesBase64: "" },
  { op: "upsert", path: "notes/b.md", bytesBase64: "" },
];

describe("readVaultReply", () => {
  it("adopts the answered revision when everything landed", () => {
    const outcome = readVaultReply(4, WROTE, { kind: "vault", revision: 6, rejected: [] });
    expect(outcome).toEqual({ revision: 6, notice: "" });
  });

  it("names every refusal so the model can act on it", () => {
    const outcome = readVaultReply(4, WROTE, {
      kind: "vault",
      revision: 5,
      rejected: ["notes/b.md: use delete_note, which asks the user first"],
    });
    expect(outcome.revision).toBe(5);
    expect(outcome.notice).toContain("notes/b.md");
    expect(outcome.notice).toContain("delete_note");
    // The whole point of relaying it: the copy on disk is not the record.
    expect(outcome.notice).toContain("unchanged for the user");
  });

  it("keeps the held revision and says nothing is known when the reply is lost", () => {
    const outcome = readVaultReply(4, WROTE, null);
    expect(outcome.revision).toBe(4);
    expect(outcome.notice).toContain("UNKNOWN");
    for (const op of WROTE) expect(outcome.notice).toContain(op.path);
  });

  it("treats an answer of the wrong kind as no answer at all", () => {
    const outcome = readVaultReply(4, WROTE, { kind: "ack" });
    expect(outcome.revision).toBe(4);
    expect(outcome.notice).toContain("UNKNOWN");
  });

  it("has nothing to say about an empty batch that went nowhere", () => {
    expect(readVaultReply(4, [], null)).toEqual({ revision: 4, notice: "" });
  });
});

function harness(reply: AgentReportReply | null) {
  const sent: AgentReport[] = [];
  const told: string[] = [];
  let revision = 4;
  const report = createVaultReport({
    reporter: {
      send: (payload) => {
        sent.push(payload);
        return Promise.resolve(reply);
      },
    },
    heldRevision: () => revision,
    setRevision: (next) => {
      revision = next;
    },
    tellAgent: (text) => {
      told.push(text);
      return Promise.resolve();
    },
  });
  return { report, sent, told, held: () => revision };
}

describe("the watcher's report callback", () => {
  it("reports the baseline these ops were made on top of", async () => {
    const h = harness({ kind: "vault", revision: 6, rejected: [] });
    await h.report(WROTE);
    expect(h.sent).toEqual([{ kind: "vault", fromRevision: 4, ops: WROTE }]);
  });

  // Without this the container's revision never moves past what the host
  // pushed, so every later wake re-materializes the agent's own bytes over it.
  it("adopts the revision the object answered with", async () => {
    const h = harness({ kind: "vault", revision: 6, rejected: [] });
    await h.report(WROTE);
    expect(h.held()).toBe(6);
    expect(h.told).toEqual([]);
  });

  it("tells the agent what the vault of record refused", async () => {
    const h = harness({
      kind: "vault",
      revision: 5,
      rejected: ["notes/b.md: use delete_note, which asks the user first"],
    });
    await h.report(WROTE);
    expect(h.told).toHaveLength(1);
    expect(h.told[0]).toContain("notes/b.md");
  });

  it("tells the agent when the report never landed, and holds its revision", async () => {
    const h = harness(null);
    await h.report(WROTE);
    expect(h.held()).toBe(4);
    expect(h.told[0]).toContain("UNKNOWN");
  });
});
