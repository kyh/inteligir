import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import nodePath from "node:path";
import { noopNotifier } from "@repo/domain/notifier";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../__tests__/temp-dir";
import { createVaultService } from "../../vault/vault-service";
import type { VaultService } from "../../vault/vault-service";
import {
  commentsStorePath,
  parseSidecar,
  serializeSidecar,
} from "@repo/notes/comments/sidecar-schema";
import type { CommentSidecar } from "@repo/notes/comments/sidecar-schema";
import { frontmatterId } from "@repo/notes/markdown/frontmatter";
import { CommentRefusedError } from "../comment-refused-error";
import { SidecarConflictError } from "../sidecar-conflict-error";
import { SidecarInvalidError } from "../sidecar-invalid-error";
import { createCommentsService } from "../comments-service";
import { identityLock } from "../../__tests__/identity-lock";
import { ignoreFromDisk } from "../../__tests__/ignore-from-disk";

const AT = 1_707_900_000;
const NOTE_ID = "0f6a3b1e-5c2d-4e8f-9a7b-1c3d5e7f9a0b";
const WITH_ID = `---\nid: ${NOTE_ID}\n---\nnote\n`;

const boot = () => {
  const root = nodePath.join(makeTempDir("inteligir-comments-"), "vault");
  mkdirSync(root, { recursive: true });
  const vault = createVaultService({
    ignore: ignoreFromDisk(root),
    lock: identityLock,
    notifier: noopNotifier,
    root,
  });
  let tick = 0;
  const comments = createCommentsService(vault, () => {
    const at = AT + tick;
    tick += 1;
    return at;
  });
  return { comments, root, vault };
};

// each store read is followed by a writer landing the next of `landing` on disk,
// merged over what the read saw; reads past the list run clean.
const racedVault = (args: {
  vault: VaultService;
  root: string;
  storePath: string;
  landing: readonly CommentSidecar[];
}): VaultService => {
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
          mkdirSync(nodePath.join(args.root, ".inteligir", "comments"), { recursive: true });
          writeFileSync(nodePath.join(args.root, args.storePath), serializeSidecar(entry));
        }
        throw error;
      }
      if (entry !== undefined) {
        const held = parseSidecar(result.content);
        if (!held.ok) {
          throw new Error(held.error);
        }
        writeFileSync(
          nodePath.join(args.root, args.storePath),
          serializeSidecar({ ...held.sidecar, ...entry }),
        );
      }
      return result;
    },
  };
};

// the store is found through the note: its id keys the file
const storePathOf = (root: string, notePath: string): string => {
  const id = frontmatterId(readFileSync(nodePath.join(root, notePath), "utf-8"));
  if (id === null) {
    throw new Error(`${notePath} has no id`);
  }
  return commentsStorePath(id);
};

const storeRaw = (root: string, notePath: string): string =>
  readFileSync(nodePath.join(root, storePathOf(root, notePath)), "utf-8");

const storeOnDisk = (root: string, notePath: string): CommentSidecar => {
  const parsed = parseSidecar(storeRaw(root, notePath));
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.sidecar;
};

describe("comments service", () => {
  it("adds, replies, resolves and lists against the note's live markers", async () => {
    const { root, comments } = boot();
    writeFileSync(
      nodePath.join(root, "plan.md"),
      "The %%i:c1:start%%layout%%i:c1:end%% needs review.\n",
    );

    await comments.add({ id: "c1", path: "plan.md", text: "Should this ship?" });
    await comments.reply({ id: "c1-r1", parentId: "c1", path: "plan.md", text: "Yes." });
    const listed = await comments.list("plan.md");

    expect(listed.total).toBe(1);
    const [thread] = listed.threads;
    expect(thread?.anchored).toBe(true);
    expect(thread?.replies.map((reply) => reply.id)).toEqual(["c1-r1"]);
    expect(thread?.root.source).toBe("user");

    const { answer: resolved } = await comments.resolve({
      id: "c1",
      path: "plan.md",
      resolved: true,
    });
    expect(resolved.threads[0]?.resolved).toBe(true);
    expect(resolved.threads[0]?.replies[0]?.entry.resolvedBy).toBe("user");
  });

  it("mints an id into a note that has none, once, and keys the store by it", async () => {
    const { root, comments } = boot();
    writeFileSync(nodePath.join(root, "plan.md"), "---\ntags:\n  - a\n---\nbody\n");

    await comments.add({ id: "c1", path: "plan.md", text: "first" });
    const afterFirst = readFileSync(nodePath.join(root, "plan.md"), "utf-8");
    const id = frontmatterId(afterFirst);
    expect(id).toMatch(/^[a-f0-9-]{36}$/u);
    expect(afterFirst).toBe(`---\nid: ${id}\ntags:\n  - a\n---\nbody\n`);

    await comments.add({ id: "c2", path: "plan.md", text: "second" });
    expect(readFileSync(nodePath.join(root, "plan.md"), "utf-8")).toBe(afterFirst);
    expect(Object.keys(storeOnDisk(root, "plan.md")).toSorted()).toEqual(["c1", "c2"]);
  });

  it("keeps the id a note already carries", async () => {
    const { root, comments } = boot();
    writeFileSync(nodePath.join(root, "plan.md"), WITH_ID);
    await comments.add({ id: "c1", path: "plan.md", text: "x" });
    expect(readFileSync(nodePath.join(root, "plan.md"), "utf-8")).toBe(WITH_ID);
    expect(existsSync(nodePath.join(root, commentsStorePath(NOTE_ID)))).toBe(true);
  });

  it("a read mints nothing: a note without an id lists empty and stays as written", async () => {
    const { root, comments } = boot();
    writeFileSync(nodePath.join(root, "plan.md"), "plain\n");
    const listed = await comments.list("plan.md");
    expect(listed.total).toBe(0);
    expect(readFileSync(nodePath.join(root, "plan.md"), "utf-8")).toBe("plain\n");
    expect(existsSync(nodePath.join(root, ".inteligir"))).toBe(false);
  });

  it("refuses an id that cannot name a file rather than escaping the store's folder", async () => {
    const { root, comments } = boot();
    writeFileSync(nodePath.join(root, "plan.md"), "---\nid: ../escape\n---\nnote\n");
    await expect(comments.add({ id: "c1", path: "plan.md", text: "x" })).rejects.toThrow(
      CommentRefusedError,
    );
  });

  it("refuses rather than overwrites an id that is not text, naming it", async () => {
    const { root, comments } = boot();
    const numbered = "---\nid: 42\n---\nnote\n";
    writeFileSync(nodePath.join(root, "plan.md"), numbered);
    await expect(comments.add({ id: "c1", path: "plan.md", text: "x" })).rejects.toThrow(
      /frontmatter id 42 is not text/u,
    );
    expect(readFileSync(nodePath.join(root, "plan.md"), "utf-8")).toBe(numbered);
    expect(existsSync(nodePath.join(root, ".inteligir"))).toBe(false);
  });

  it("comments follow the note through a rename", async () => {
    const { root, vault, comments } = boot();
    writeFileSync(nodePath.join(root, "plan.md"), "%%i:c1:start%%x%%i:c1:end%%\n");
    await comments.add({ id: "c1", path: "plan.md", text: "root" });
    await vault.rename("plan.md", "renamed.md");
    const listed = await comments.list("renamed.md");
    expect(listed.total).toBe(1);
    expect(listed.threads[0]?.anchored).toBe(true);
  });

  it("derives anchored=false for a root the body never marks, and flags orphan markers", async () => {
    const { root, comments } = boot();
    writeFileSync(
      nodePath.join(root, "plan.md"),
      "A %%i:ghost:start%%range%%i:ghost:end%% here.\n",
    );
    await comments.add({ id: "unanchored", path: "plan.md", text: "floating" });
    const listed = await comments.list("plan.md");
    expect(listed.threads[0]?.anchored).toBe(false);
    expect(listed.orphanMarkers).toEqual(["ghost"]);
  });

  it("remove deletes the whole chain and answers which ids died", async () => {
    const { root, comments } = boot();
    writeFileSync(nodePath.join(root, "plan.md"), "%%i:c1:start%%x%%i:c1:end%%\n");
    await comments.add({ id: "c1", path: "plan.md", text: "root" });
    await comments.reply({ id: "r1", parentId: "c1", path: "plan.md", text: "reply" });
    const { answer: removed } = await comments.remove({ id: "c1", path: "plan.md" });
    expect(removed.removedIds.toSorted()).toEqual(["c1", "r1"]);
    expect(removed.total).toBe(0);
    expect(storeRaw(root, "plan.md")).toBe("{}\n");
  });

  it("add against a missing note refuses; list still answers", async () => {
    const { comments } = boot();
    await expect(comments.add({ id: "c1", path: "absent.md", text: "x" })).rejects.toThrow();
    const listed = await comments.list("absent.md");
    expect(listed.total).toBe(0);
  });

  it("signs an entry with the source the caller states, and `user` when it states none", async () => {
    const { root, comments } = boot();
    writeFileSync(nodePath.join(root, "plan.md"), "note\n");
    await comments.add({ id: "a1", path: "plan.md", source: "agent", text: "from the agent" });
    await comments.reply({ id: "a1-r1", parentId: "a1", path: "plan.md", text: "silent" });
    await comments.reply({
      id: "a1-r2",
      parentId: "a1",
      path: "plan.md",
      source: "external",
      text: "scripted",
    });
    const { answer: resolved } = await comments.resolve({
      id: "a1",
      path: "plan.md",
      resolved: true,
      source: "agent",
    });
    const [thread] = resolved.threads;
    expect(thread?.root.source).toBe("agent");
    expect(thread?.replies.map((reply) => reply.entry.source)).toEqual(["user", "external"]);
    expect(thread?.root.resolvedBy).toBe("agent");
  });
});

describe("what a call wrote", () => {
  it("names the note it minted an id into and the store, and only what it wrote", async () => {
    const { root, comments } = boot();
    writeFileSync(nodePath.join(root, "plan.md"), "The %%i:c1:start%%plan%%i:c1:end%%.\n");

    const added = await comments.add({ id: "c1", path: "plan.md", text: "why?" });
    const storePath = storePathOf(root, "plan.md");
    expect(added.wrote).toEqual(["plan.md", storePath]);

    const replied = await comments.reply({ id: "r1", parentId: "c1", path: "plan.md", text: "so" });
    expect(replied.wrote).toEqual([storePath]);
  });
});

describe("an unparseable store", () => {
  it("is reported by its own name and left, and the edit is refused", async () => {
    const { root, comments } = boot();
    writeFileSync(nodePath.join(root, "plan.md"), WITH_ID);
    const store = nodePath.join(root, commentsStorePath(NOTE_ID));
    mkdirSync(nodePath.dirname(store), { recursive: true });
    writeFileSync(store, "{broken");
    await expect(comments.add({ id: "c1", path: "plan.md", text: "x" })).rejects.toThrow(
      SidecarInvalidError,
    );
    await expect(comments.list("plan.md")).rejects.toThrow(commentsStorePath(NOTE_ID));
    expect(readFileSync(store, "utf-8")).toBe("{broken");
  });
});

describe("a file beside the note named like a comment store", () => {
  it("is the user's own: a list reads nothing from it and leaves it as found", async () => {
    const { root, comments } = boot();
    writeFileSync(nodePath.join(root, "plan.md"), "note\n");
    const beside = nodePath.join(root, "plan.md.comments.json");
    writeFileSync(beside, serializeSidecar({ m1: { createdAt: AT, text: "mine", updatedAt: AT } }));

    const listed = await comments.list("plan.md");

    expect(listed.total).toBe(0);
    expect(existsSync(beside)).toBe(true);
    expect(readFileSync(nodePath.join(root, "plan.md"), "utf-8")).toBe("note\n");
  });
});

describe("the store write is a compare-and-swap", () => {
  const STORE = commentsStorePath(NOTE_ID);
  const OTHER: CommentSidecar = {
    theirs: {
      createdAt: AT,
      source: "agent",
      text: "landed between read and write",
      updatedAt: AT,
    },
  };

  const bootWithStore = (landing: readonly CommentSidecar[], seeded: boolean) => {
    const { root, vault } = boot();
    writeFileSync(nodePath.join(root, "plan.md"), WITH_ID);
    if (seeded) {
      mkdirSync(nodePath.join(root, ".inteligir", "comments"), { recursive: true });
      writeFileSync(nodePath.join(root, STORE), serializeSidecar({}));
    }
    const raced = racedVault({ landing, root, storePath: STORE, vault });
    return { comments: createCommentsService(raced, () => AT), root };
  };

  it("keeps an entry that landed between the read and the write, by re-folding over it", async () => {
    const { root, comments } = bootWithStore([OTHER], true);

    const { answer } = await comments.add({ id: "ours", path: "plan.md", text: "ours" });

    expect(answer.threads.map((thread) => thread.rootId).toSorted()).toEqual(["ours", "theirs"]);
    expect(Object.keys(storeOnDisk(root, "plan.md")).toSorted()).toEqual(["ours", "theirs"]);
  });

  it("creates the store only if none appeared since the read said so", async () => {
    const { root, comments } = bootWithStore([OTHER], false);

    await comments.add({ id: "ours", path: "plan.md", text: "ours" });

    expect(Object.keys(storeOnDisk(root, "plan.md")).toSorted()).toEqual(["ours", "theirs"]);
  });

  it("refuses as a conflict, writing nothing, when the file moves under both attempts", async () => {
    const another: CommentSidecar = {
      more: { createdAt: AT, source: "agent", text: "and again under the retry", updatedAt: AT },
    };
    const { root, comments } = bootWithStore([OTHER, another], true);

    await expect(comments.add({ id: "ours", path: "plan.md", text: "ours" })).rejects.toThrow(
      SidecarConflictError,
    );
    expect(Object.keys(storeOnDisk(root, "plan.md")).toSorted()).toEqual(["more", "theirs"]);
  });

  it("re-judges the edit against what the retry read, so a taken id is refused rather than re-applied", async () => {
    const taken: CommentSidecar = {
      ours: { createdAt: AT, source: "agent", text: "the other writer used our id", updatedAt: AT },
    };
    const { root, comments } = bootWithStore([taken], true);

    await expect(comments.add({ id: "ours", path: "plan.md", text: "ours" })).rejects.toThrow(
      /already exists/u,
    );
    expect(storeOnDisk(root, "plan.md").ours?.text).toBe("the other writer used our id");
  });
});
