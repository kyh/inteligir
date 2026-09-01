// The comments service over a REAL vault service: the sidecar is an ordinary
// vault file (containment, notify, auto-commit all ride the same write), and
// `anchored` derives from the note's own markers on every answer.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { noopNotifier } from "@repo/domain/notifier";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../__tests__/temp-dir";
import { createVaultService, type VaultService } from "../../vault/vault-service";
import {
  commentsSidecarPath,
  parseSidecar,
  serializeSidecar,
  type CommentSidecar,
} from "@repo/notes/comments/sidecar-schema";
import { createCommentsService, SidecarConflictError } from "../comments-service";
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

/** A vault whose reads of the note's sidecar are each followed by a writer
 *  landing the next of `landing` on disk, merged over what the read saw — the
 *  window between the service's read and its write, opened on purpose. Reads
 *  past the list run clean. */
function racedVault(args: {
  vault: VaultService;
  root: string;
  notePath: string;
  landing: readonly CommentSidecar[];
}): VaultService {
  const sidecar = commentsSidecarPath(args.notePath);
  const pending = [...args.landing];
  return {
    ...args.vault,
    async read(path) {
      const entry = path === sidecar ? pending.shift() : undefined;
      let result;
      try {
        result = await args.vault.read(path);
      } catch (error) {
        if (entry !== undefined) writeFileSync(join(args.root, sidecar), serializeSidecar(entry));
        throw error;
      }
      if (entry !== undefined) {
        const held = parseSidecar(result.content);
        if (!held.ok) throw new Error(held.error);
        writeFileSync(join(args.root, sidecar), serializeSidecar({ ...held.sidecar, ...entry }));
      }
      return result;
    },
  };
}

function sidecarOnDisk(root: string, notePath: string): CommentSidecar {
  const parsed = parseSidecar(readFileSync(join(root, commentsSidecarPath(notePath)), "utf8"));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.sidecar;
}

describe("comments service", () => {
  it("adds, replies, resolves and lists against the note's live markers", async () => {
    const { root, comments } = boot();
    writeFileSync(join(root, "plan.md"), "The %%i:c1:start%%layout%%i:c1:end%% needs review.\n");

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
    writeFileSync(join(root, "plan.md"), "A %%i:ghost:start%%range%%i:ghost:end%% here.\n");
    await comments.add({ path: "plan.md", id: "unanchored", text: "floating" });
    const listed = await comments.list("plan.md");
    expect(listed.threads[0]?.anchored).toBe(false);
    expect(listed.orphanMarkers).toEqual(["ghost"]);
  });

  it("remove deletes the whole chain and answers which ids died", async () => {
    const { root, comments } = boot();
    writeFileSync(join(root, "plan.md"), "%%i:c1:start%%x%%i:c1:end%%\n");
    await comments.add({ path: "plan.md", id: "c1", text: "root" });
    await comments.reply({ path: "plan.md", id: "r1", parentId: "c1", text: "reply" });
    const removed = await comments.remove({ path: "plan.md", id: "c1" });
    expect(removed.removedIds.toSorted()).toEqual(["c1", "r1"]);
    expect(removed.total).toBe(0);
    const raw = readFileSync(join(root, commentsSidecarPath("plan.md")), "utf8");
    expect(raw).toBe("{}\n");
  });

  it("preserves an external writer's unknown fields through a mutation", async () => {
    const { root, comments } = boot();
    writeFileSync(join(root, "plan.md"), "note\n");
    writeFileSync(
      join(root, commentsSidecarPath("plan.md")),
      `${JSON.stringify(
        { m1: { text: "inteligir wrote this", createdAt: AT, updatedAt: AT, inteligirOnly: true } },
        null,
        2,
      )}\n`,
    );
    await comments.add({ path: "plan.md", id: "n1", text: "ours" });
    const raw = readFileSync(join(root, commentsSidecarPath("plan.md")), "utf8");
    expect(raw).toContain('"inteligirOnly": true');
  });

  it("refuses to write over a malformed sidecar instead of erasing it", async () => {
    const { root, comments } = boot();
    writeFileSync(join(root, "plan.md"), "note\n");
    writeFileSync(join(root, commentsSidecarPath("plan.md")), "{broken");
    await expect(comments.add({ path: "plan.md", id: "c1", text: "x" })).rejects.toThrow();
    expect(readFileSync(join(root, commentsSidecarPath("plan.md")), "utf8")).toBe("{broken");
  });

  it("add against a missing note refuses; list still answers", async () => {
    const { comments } = boot();
    await expect(comments.add({ path: "absent.md", id: "c1", text: "x" })).rejects.toThrow();
    const listed = await comments.list("absent.md");
    expect(listed.total).toBe(0);
  });

  it("signs an entry with the source the caller states, and `user` when it states none", async () => {
    const { root, comments } = boot();
    writeFileSync(join(root, "plan.md"), "note\n");
    await comments.add({ path: "plan.md", id: "a1", text: "from the agent", source: "agent" });
    await comments.reply({ path: "plan.md", id: "a1-r1", parentId: "a1", text: "silent" });
    await comments.reply({
      path: "plan.md",
      id: "a1-r2",
      parentId: "a1",
      text: "scripted",
      source: "external",
    });
    const resolved = await comments.resolve({
      path: "plan.md",
      id: "a1",
      resolved: true,
      source: "agent",
    });
    const thread = resolved.threads[0];
    expect(thread?.root.source).toBe("agent");
    expect(thread?.replies.map((reply) => reply.entry.source)).toEqual(["user", "external"]);
    expect(thread?.root.resolvedBy).toBe("agent");
  });
});

describe("the sidecar write is a compare-and-swap", () => {
  const OTHER: CommentSidecar = {
    theirs: {
      text: "landed between read and write",
      createdAt: AT,
      updatedAt: AT,
      source: "agent",
    },
  };

  it("keeps an entry that landed between the read and the write, by re-folding over it", async () => {
    const { root, vault } = boot();
    writeFileSync(join(root, "plan.md"), "note\n");
    writeFileSync(join(root, commentsSidecarPath("plan.md")), serializeSidecar({}));
    const raced = racedVault({ vault, root, notePath: "plan.md", landing: [OTHER] });
    const comments = createCommentsService(raced, () => AT);

    const answer = await comments.add({ path: "plan.md", id: "ours", text: "ours" });

    expect(answer.threads.map((thread) => thread.rootId).toSorted()).toEqual(["ours", "theirs"]);
    expect(Object.keys(sidecarOnDisk(root, "plan.md")).toSorted()).toEqual(["ours", "theirs"]);
  });

  it("creates the sidecar only if none appeared since the read said so", async () => {
    const { root, vault } = boot();
    writeFileSync(join(root, "plan.md"), "note\n");
    const raced = racedVault({ vault, root, notePath: "plan.md", landing: [OTHER] });
    const comments = createCommentsService(raced, () => AT);

    await comments.add({ path: "plan.md", id: "ours", text: "ours" });

    expect(Object.keys(sidecarOnDisk(root, "plan.md")).toSorted()).toEqual(["ours", "theirs"]);
  });

  it("refuses as a conflict, writing nothing, when the file moves under both attempts", async () => {
    const { root, vault } = boot();
    writeFileSync(join(root, "plan.md"), "note\n");
    writeFileSync(join(root, commentsSidecarPath("plan.md")), serializeSidecar({}));
    const another: CommentSidecar = {
      more: { text: "and again under the retry", createdAt: AT, updatedAt: AT, source: "agent" },
    };
    const raced = racedVault({ vault, root, notePath: "plan.md", landing: [OTHER, another] });
    const comments = createCommentsService(raced, () => AT);

    await expect(comments.add({ path: "plan.md", id: "ours", text: "ours" })).rejects.toThrow(
      SidecarConflictError,
    );
    expect(Object.keys(sidecarOnDisk(root, "plan.md")).toSorted()).toEqual(["more", "theirs"]);
  });

  it("re-judges the edit against what the retry read, so a taken id is refused rather than re-applied", async () => {
    const { root, vault } = boot();
    writeFileSync(join(root, "plan.md"), "note\n");
    writeFileSync(join(root, commentsSidecarPath("plan.md")), serializeSidecar({}));
    const taken: CommentSidecar = {
      ours: { text: "the other writer used our id", createdAt: AT, updatedAt: AT, source: "agent" },
    };
    const raced = racedVault({ vault, root, notePath: "plan.md", landing: [taken] });
    const comments = createCommentsService(raced, () => AT);

    await expect(comments.add({ path: "plan.md", id: "ours", text: "ours" })).rejects.toThrow(
      /already exists/u,
    );
    expect(sidecarOnDisk(root, "plan.md")["ours"]?.text).toBe("the other writer used our id");
  });
});
