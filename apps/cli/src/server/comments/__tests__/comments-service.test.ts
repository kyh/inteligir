import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { noopNotifier } from "@repo/domain/notifier";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../__tests__/temp-dir";
import { createVaultService, type VaultService } from "../../vault/vault-service";
import {
  commentsStorePath,
  legacyCommentsSidecarPath,
  parseSidecar,
  serializeSidecar,
  type CommentSidecar,
} from "@repo/notes/comments/sidecar-schema";
import { frontmatterId } from "@repo/notes/markdown/frontmatter";
import {
  CommentRefusedError,
  createCommentsService,
  SidecarConflictError,
  SidecarInvalidError,
} from "../comments-service";
import { identityLock } from "../../__tests__/identity-lock";

const AT = 1_707_900_000;
const NOTE_ID = "0f6a3b1e-5c2d-4e8f-9a7b-1c3d5e7f9a0b";
const WITH_ID = `---\nid: ${NOTE_ID}\n---\nnote\n`;

function boot() {
  const root = join(makeTempDir("inteligir-comments-"), "vault");
  mkdirSync(root, { recursive: true });
  const vault = createVaultService({ lock: identityLock, notifier: noopNotifier, root });
  let tick = 0;
  const comments = createCommentsService(vault, () => AT + tick++);
  return { root, vault, comments };
}

// each store read is followed by a writer landing the next of `landing` on disk,
// merged over what the read saw; reads past the list run clean.
function racedVault(args: {
  vault: VaultService;
  root: string;
  storePath: string;
  landing: readonly CommentSidecar[];
}): VaultService {
  const pending = [...args.landing];
  return {
    ...args.vault,
    async read(path) {
      const entry = path === args.storePath ? pending.shift() : undefined;
      let result;
      try {
        result = await args.vault.read(path);
      } catch (error) {
        if (entry !== undefined) {
          mkdirSync(join(args.root, ".inteligir", "comments"), { recursive: true });
          writeFileSync(join(args.root, args.storePath), serializeSidecar(entry));
        }
        throw error;
      }
      if (entry !== undefined) {
        const held = parseSidecar(result.content);
        if (!held.ok) throw new Error(held.error);
        writeFileSync(
          join(args.root, args.storePath),
          serializeSidecar({ ...held.sidecar, ...entry }),
        );
      }
      return result;
    },
  };
}

// the store is found through the note: its id keys the file
function storePathOf(root: string, notePath: string): string {
  const id = frontmatterId(readFileSync(join(root, notePath), "utf8"));
  if (id === null) throw new Error(`${notePath} has no id`);
  return commentsStorePath(id);
}

function storeRaw(root: string, notePath: string): string {
  return readFileSync(join(root, storePathOf(root, notePath)), "utf8");
}

function storeOnDisk(root: string, notePath: string): CommentSidecar {
  const parsed = parseSidecar(storeRaw(root, notePath));
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

  it("mints an id into a note that has none, once, and keys the store by it", async () => {
    const { root, comments } = boot();
    writeFileSync(join(root, "plan.md"), "---\ntags:\n  - a\n---\nbody\n");

    await comments.add({ path: "plan.md", id: "c1", text: "first" });
    const afterFirst = readFileSync(join(root, "plan.md"), "utf8");
    const id = frontmatterId(afterFirst);
    expect(id).toMatch(/^[a-f0-9-]{36}$/u);
    expect(afterFirst).toBe(`---\nid: ${id}\ntags:\n  - a\n---\nbody\n`);

    await comments.add({ path: "plan.md", id: "c2", text: "second" });
    expect(readFileSync(join(root, "plan.md"), "utf8")).toBe(afterFirst);
    expect(Object.keys(storeOnDisk(root, "plan.md")).toSorted()).toEqual(["c1", "c2"]);
    expect(existsSync(join(root, legacyCommentsSidecarPath("plan.md")))).toBe(false);
  });

  it("keeps the id a note already carries", async () => {
    const { root, comments } = boot();
    writeFileSync(join(root, "plan.md"), WITH_ID);
    await comments.add({ path: "plan.md", id: "c1", text: "x" });
    expect(readFileSync(join(root, "plan.md"), "utf8")).toBe(WITH_ID);
    expect(existsSync(join(root, commentsStorePath(NOTE_ID)))).toBe(true);
  });

  it("a read mints nothing: a note without an id lists empty and stays as written", async () => {
    const { root, comments } = boot();
    writeFileSync(join(root, "plan.md"), "plain\n");
    const listed = await comments.list("plan.md");
    expect(listed.total).toBe(0);
    expect(readFileSync(join(root, "plan.md"), "utf8")).toBe("plain\n");
    expect(existsSync(join(root, ".inteligir"))).toBe(false);
  });

  it("refuses an id that cannot name a file rather than escaping the store's folder", async () => {
    const { root, comments } = boot();
    writeFileSync(join(root, "plan.md"), "---\nid: ../escape\n---\nnote\n");
    await expect(comments.add({ path: "plan.md", id: "c1", text: "x" })).rejects.toThrow(
      CommentRefusedError,
    );
  });

  it("comments follow the note through a rename", async () => {
    const { root, vault, comments } = boot();
    writeFileSync(join(root, "plan.md"), "%%i:c1:start%%x%%i:c1:end%%\n");
    await comments.add({ path: "plan.md", id: "c1", text: "root" });
    await vault.rename("plan.md", "renamed.md");
    const listed = await comments.list("renamed.md");
    expect(listed.total).toBe(1);
    expect(listed.threads[0]?.anchored).toBe(true);
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
    expect(storeRaw(root, "plan.md")).toBe("{}\n");
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

describe("the legacy sidecar beside the note", () => {
  const LEGACY: CommentSidecar = {
    m1: { text: "written by an older build", createdAt: AT, updatedAt: AT, source: "agent" },
  };

  it("folds into the store on first touch and is removed, unknown fields kept", async () => {
    const { root, comments } = boot();
    writeFileSync(join(root, "plan.md"), WITH_ID);
    writeFileSync(
      join(root, legacyCommentsSidecarPath("plan.md")),
      `${JSON.stringify(
        { m1: { text: "inteligir wrote this", createdAt: AT, updatedAt: AT, inteligirOnly: true } },
        null,
        2,
      )}\n`,
    );

    const listed = await comments.list("plan.md");

    expect(listed.threads.map((thread) => thread.rootId)).toEqual(["m1"]);
    expect(storeRaw(root, "plan.md")).toContain('"inteligirOnly": true');
    expect(existsSync(join(root, legacyCommentsSidecarPath("plan.md")))).toBe(false);
  });

  it("mints the note's id when the legacy file has entries and the note has none", async () => {
    const { root, comments } = boot();
    writeFileSync(join(root, "plan.md"), "note\n");
    writeFileSync(join(root, legacyCommentsSidecarPath("plan.md")), serializeSidecar(LEGACY));

    await comments.list("plan.md");

    expect(frontmatterId(readFileSync(join(root, "plan.md"), "utf8"))).not.toBeNull();
    expect(Object.keys(storeOnDisk(root, "plan.md"))).toEqual(["m1"]);
  });

  it("merges under the store's own entries when both hold an id", async () => {
    const { root, comments } = boot();
    writeFileSync(join(root, "plan.md"), WITH_ID);
    await comments.add({ path: "plan.md", id: "m1", text: "the store's" });
    writeFileSync(join(root, legacyCommentsSidecarPath("plan.md")), serializeSidecar(LEGACY));

    await comments.list("plan.md");

    expect(storeOnDisk(root, "plan.md")["m1"]?.text).toBe("the store's");
  });

  it("an unparseable one is reported by its own name and left, and the edit is refused", async () => {
    const { root, comments } = boot();
    writeFileSync(join(root, "plan.md"), WITH_ID);
    writeFileSync(join(root, legacyCommentsSidecarPath("plan.md")), "{broken");
    await expect(comments.add({ path: "plan.md", id: "c1", text: "x" })).rejects.toThrow(
      SidecarInvalidError,
    );
    await expect(comments.list("plan.md")).rejects.toThrow(/plan\.md\.comments\.json/u);
    expect(readFileSync(join(root, legacyCommentsSidecarPath("plan.md")), "utf8")).toBe("{broken");
  });

  it("an empty one is simply removed, and nothing is minted for it", async () => {
    const { root, comments } = boot();
    writeFileSync(join(root, "plan.md"), "note\n");
    writeFileSync(join(root, legacyCommentsSidecarPath("plan.md")), "{}\n");
    await comments.list("plan.md");
    expect(existsSync(join(root, legacyCommentsSidecarPath("plan.md")))).toBe(false);
    expect(readFileSync(join(root, "plan.md"), "utf8")).toBe("note\n");
  });
});

describe("the store write is a compare-and-swap", () => {
  const STORE = commentsStorePath(NOTE_ID);
  const OTHER: CommentSidecar = {
    theirs: {
      text: "landed between read and write",
      createdAt: AT,
      updatedAt: AT,
      source: "agent",
    },
  };

  function bootWithStore(landing: readonly CommentSidecar[], seeded: boolean) {
    const { root, vault } = boot();
    writeFileSync(join(root, "plan.md"), WITH_ID);
    if (seeded) {
      mkdirSync(join(root, ".inteligir", "comments"), { recursive: true });
      writeFileSync(join(root, STORE), serializeSidecar({}));
    }
    const raced = racedVault({ vault, root, storePath: STORE, landing });
    return { root, comments: createCommentsService(raced, () => AT) };
  }

  it("keeps an entry that landed between the read and the write, by re-folding over it", async () => {
    const { root, comments } = bootWithStore([OTHER], true);

    const answer = await comments.add({ path: "plan.md", id: "ours", text: "ours" });

    expect(answer.threads.map((thread) => thread.rootId).toSorted()).toEqual(["ours", "theirs"]);
    expect(Object.keys(storeOnDisk(root, "plan.md")).toSorted()).toEqual(["ours", "theirs"]);
  });

  it("creates the store only if none appeared since the read said so", async () => {
    const { root, comments } = bootWithStore([OTHER], false);

    await comments.add({ path: "plan.md", id: "ours", text: "ours" });

    expect(Object.keys(storeOnDisk(root, "plan.md")).toSorted()).toEqual(["ours", "theirs"]);
  });

  it("refuses as a conflict, writing nothing, when the file moves under both attempts", async () => {
    const another: CommentSidecar = {
      more: { text: "and again under the retry", createdAt: AT, updatedAt: AT, source: "agent" },
    };
    const { root, comments } = bootWithStore([OTHER, another], true);

    await expect(comments.add({ path: "plan.md", id: "ours", text: "ours" })).rejects.toThrow(
      SidecarConflictError,
    );
    expect(Object.keys(storeOnDisk(root, "plan.md")).toSorted()).toEqual(["more", "theirs"]);
  });

  it("re-judges the edit against what the retry read, so a taken id is refused rather than re-applied", async () => {
    const taken: CommentSidecar = {
      ours: { text: "the other writer used our id", createdAt: AT, updatedAt: AT, source: "agent" },
    };
    const { root, comments } = bootWithStore([taken], true);

    await expect(comments.add({ path: "plan.md", id: "ours", text: "ours" })).rejects.toThrow(
      /already exists/u,
    );
    expect(storeOnDisk(root, "plan.md")["ours"]?.text).toBe("the other writer used our id");
  });
});
