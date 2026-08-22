// The comments service over a REAL vault service: the sidecar is an ordinary
// vault file (containment, notify, auto-commit all ride the same write), and
// `anchored` derives from the note's own markers on every answer.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { noopNotifier } from "@repo/domain/notifier";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../__tests__/temp-dir";
import { createVaultService } from "../../vault/vault-service";
import { createCommentsService, sidecarPathFor } from "../comments-service";
import { identityLock } from "../../__tests__/identity-lock";

const AT = 1_707_900_000;

function boot() {
  const root = join(makeTempDir("inteligir-comments-"), "vault");
  mkdirSync(root, { recursive: true });
  const vault = createVaultService({ lock: identityLock, notifier: noopNotifier, root });
  let tick = 0;
  const comments = createCommentsService(vault, () => AT + tick++);
  return { root, vault, comments };
}

describe("comments service", () => {
  it("adds, replies, resolves and lists against the note's live markers", async () => {
    const { root, comments } = boot();
    writeFileSync(join(root, "plan.md"), "The %%m:c1:start%%layout%%m:c1:end%% needs review.\n");

    await comments.add({ path: "plan.md", id: "c1", text: "Should this ship?" });
    await comments.reply({ path: "plan.md", id: "c1-r1", parentId: "c1", text: "Yes." });
    const listed = await comments.list("plan.md");

    expect(listed.total).toBe(1);
    const thread = listed.threads[0];
    expect(thread?.anchored).toBe(true);
    expect(thread?.replies.map((reply) => reply.id)).toEqual(["c1-r1"]);
    expect(thread?.root.source).toBe("user");

    const resolved = await comments.resolve({ path: "plan.md", id: "c1", resolved: true });
    expect(resolved.threads[0]?.resolved).toBe(true);
    expect(resolved.threads[0]?.replies[0]?.entry.resolvedBy).toBe("user");
  });

  it("derives anchored=false for a root the body never marks, and flags orphan markers", async () => {
    const { root, comments } = boot();
    writeFileSync(join(root, "plan.md"), "A %%m:ghost:start%%range%%m:ghost:end%% here.\n");
    await comments.add({ path: "plan.md", id: "unanchored", text: "floating" });
    const listed = await comments.list("plan.md");
    expect(listed.threads[0]?.anchored).toBe(false);
    expect(listed.orphanMarkers).toEqual(["ghost"]);
  });

  it("remove deletes the whole chain and answers which ids died", async () => {
    const { root, comments } = boot();
    writeFileSync(join(root, "plan.md"), "%%m:c1:start%%x%%m:c1:end%%\n");
    await comments.add({ path: "plan.md", id: "c1", text: "root" });
    await comments.reply({ path: "plan.md", id: "r1", parentId: "c1", text: "reply" });
    const removed = await comments.remove({ path: "plan.md", id: "c1" });
    expect(removed.removedIds.toSorted()).toEqual(["c1", "r1"]);
    expect(removed.total).toBe(0);
    const raw = readFileSync(join(root, sidecarPathFor("plan.md")), "utf8");
    expect(raw).toBe("{}\n");
  });

  it("preserves an external writer's unknown fields through a mutation", async () => {
    const { root, comments } = boot();
    writeFileSync(join(root, "plan.md"), "note\n");
    writeFileSync(
      join(root, sidecarPathFor("plan.md")),
      `${JSON.stringify(
        { m1: { text: "moss wrote this", createdAt: AT, updatedAt: AT, mossOnly: true } },
        null,
        2,
      )}\n`,
    );
    await comments.add({ path: "plan.md", id: "n1", text: "ours" });
    const raw = readFileSync(join(root, sidecarPathFor("plan.md")), "utf8");
    expect(raw).toContain('"mossOnly": true');
  });

  it("refuses to write over a malformed sidecar instead of erasing it", async () => {
    const { root, comments } = boot();
    writeFileSync(join(root, "plan.md"), "note\n");
    writeFileSync(join(root, sidecarPathFor("plan.md")), "{broken");
    await expect(comments.add({ path: "plan.md", id: "c1", text: "x" })).rejects.toThrow();
    expect(readFileSync(join(root, sidecarPathFor("plan.md")), "utf8")).toBe("{broken");
  });

  it("add against a missing note refuses; list still answers", async () => {
    const { comments } = boot();
    await expect(comments.add({ path: "absent.md", id: "c1", text: "x" })).rejects.toThrow();
    const listed = await comments.list("absent.md");
    expect(listed.total).toBe(0);
  });
});
