import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import nodePath from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../test-support/temp-dir";
import { createVaultService } from "../vault/vault-service";
import type { VaultService } from "../vault/vault-service";
import {
  annotationsStorePath,
  parseAnnotationStore,
  serializeAnnotationStore,
} from "@repo/notes/annotations/store-schema";
import type { AnnotationStore } from "@repo/notes/annotations/store-schema";
import { frontmatterId } from "@repo/notes/markdown/frontmatter";
import { AnnotationsError, createAnnotationsService } from "./annotations-service";
import type { AnnotationsErrorCode } from "./annotations-service";
import { identityLock } from "../test-support/identity-lock";
import { ignoreFromDisk } from "../test-support/ignore-from-disk";

const AT = 1_707_900_000;
const NOTE_ID = "0f6a3b1e-5c2d-4e8f-9a7b-1c3d5e7f9a0b";
const WITH_ID = `---\nid: ${NOTE_ID}\n---\nnote\n`;

const refusalCode = async (work: Promise<unknown>): Promise<AnnotationsErrorCode | null> => {
  try {
    await work;
  } catch (error) {
    if (error instanceof AnnotationsError) {
      return error.code;
    }
    throw error;
  }
  return null;
};

// the suite's notes never move, so no lookup by id is asked
const NO_KNOWLEDGE = { pathForNoteId: async () => await Promise.resolve(null) };

const boot = () => {
  const root = nodePath.join(makeTempDir("inteligir-annotations-"), "vault");
  mkdirSync(root, { recursive: true });
  const vault = createVaultService({
    ignore: ignoreFromDisk(root),
    lock: identityLock,
    root,
  });
  let tick = 0;
  const annotations = createAnnotationsService({
    knowledge: NO_KNOWLEDGE,
    now: () => {
      const at = AT + tick;
      tick += 1;
      return at;
    },
    service: vault,
  });
  return { annotations, root, vault };
};

// each store read is followed by a writer landing the next of `landing` on disk,
// merged over what the read saw; reads past the list run clean.
const racedVault = (args: {
  vault: VaultService;
  root: string;
  storePath: string;
  landing: readonly AnnotationStore[];
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
          mkdirSync(nodePath.join(args.root, ".inteligir", "annotations"), { recursive: true });
          writeFileSync(nodePath.join(args.root, args.storePath), serializeAnnotationStore(entry));
        }
        throw error;
      }
      if (entry !== undefined) {
        const held = parseAnnotationStore(result.content);
        if (!held.ok) {
          throw new Error(held.error);
        }
        writeFileSync(
          nodePath.join(args.root, args.storePath),
          serializeAnnotationStore({ ...held.store, ...entry }),
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
  return annotationsStorePath(id);
};

const storeRaw = (root: string, notePath: string): string =>
  readFileSync(nodePath.join(root, storePathOf(root, notePath)), "utf-8");

const storeOnDisk = (root: string, notePath: string): AnnotationStore => {
  const parsed = parseAnnotationStore(storeRaw(root, notePath));
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.store;
};

describe("annotations service", () => {
  it("adds, replies, edits and lists against the note's live markers", async () => {
    const { root, annotations } = boot();
    writeFileSync(
      nodePath.join(root, "plan.md"),
      "The %%i:c1:start%%layout%%i:c1:end%% needs review.\n",
    );

    await annotations.add({
      id: "c1",
      path: "plan.md",
      quote: "the passage",
      text: "Should this ship?",
    });
    await annotations.reply({ id: "c1-r1", parentId: "c1", path: "plan.md", text: "Yes." });
    const listed = await annotations.list("plan.md");

    expect(listed.total).toBe(1);
    const [annotation] = listed.annotations;
    expect(annotation?.state).toBe("anchored");
    expect(annotation?.root.quote).toBe("the passage");
    expect(annotation?.quote).toBe("the passage");
    expect(annotation?.passage).toBe("layout");
    expect(annotation?.replies.map((reply) => reply.id)).toEqual(["c1-r1"]);
    expect(annotation?.root.source).toBe("user");

    const { answer: edited } = await annotations.edit({
      id: "c1",
      path: "plan.md",
      source: "agent",
      text: "Ship it.",
    });
    expect(edited.annotations[0]?.root).toMatchObject({
      quote: "the passage",
      source: "agent",
      text: "Ship it.",
    });
    expect(await refusalCode(annotations.edit({ id: "nope", path: "plan.md", text: "x" }))).toBe(
      "refused",
    );
  });

  it("keeps a bare highlight: a quote and no note", async () => {
    const { root, annotations } = boot();
    writeFileSync(nodePath.join(root, "plan.md"), "The %%i:h1:start%%layout%%i:h1:end%%.\n");
    await annotations.add({ id: "h1", path: "plan.md", quote: "layout", text: "" });
    expect(storeOnDisk(root, "plan.md").h1).toMatchObject({ quote: "layout", text: "" });
  });

  it("lists anchored annotations in the order their passages read", async () => {
    const { root, annotations } = boot();
    writeFileSync(
      nodePath.join(root, "plan.md"),
      "%%i:second:start%%a%%i:second:end%% then %%i:first:start%%b%%i:first:end%%\n",
    );
    await annotations.add({ id: "first", path: "plan.md", quote: "b", text: "" });
    await annotations.add({ id: "second", path: "plan.md", quote: "a", text: "" });
    const listed = await annotations.list("plan.md");
    expect(listed.annotations.map((annotation) => annotation.id)).toEqual(["second", "first"]);
  });

  it("mints an id into a note that has none, once, and keys the store by it", async () => {
    const { root, annotations } = boot();
    writeFileSync(nodePath.join(root, "plan.md"), "---\ntags:\n  - a\n---\nbody\n");

    await annotations.add({ id: "c1", path: "plan.md", quote: "the passage", text: "first" });
    const afterFirst = readFileSync(nodePath.join(root, "plan.md"), "utf-8");
    const id = frontmatterId(afterFirst);
    expect(id).toMatch(/^[a-f0-9-]{36}$/u);
    expect(afterFirst).toBe(`---\nid: ${id}\ntags:\n  - a\n---\nbody\n`);

    await annotations.add({ id: "c2", path: "plan.md", quote: "the passage", text: "second" });
    expect(readFileSync(nodePath.join(root, "plan.md"), "utf-8")).toBe(afterFirst);
    expect(Object.keys(storeOnDisk(root, "plan.md")).toSorted()).toEqual(["c1", "c2"]);
  });

  it("keeps the id a note already carries", async () => {
    const { root, annotations } = boot();
    writeFileSync(nodePath.join(root, "plan.md"), WITH_ID);
    await annotations.add({ id: "c1", path: "plan.md", quote: "the passage", text: "x" });
    expect(readFileSync(nodePath.join(root, "plan.md"), "utf-8")).toBe(WITH_ID);
    expect(existsSync(nodePath.join(root, annotationsStorePath(NOTE_ID)))).toBe(true);
  });

  it("a read mints nothing: a note without an id lists empty and stays as written", async () => {
    const { root, annotations } = boot();
    writeFileSync(nodePath.join(root, "plan.md"), "plain\n");
    const listed = await annotations.list("plan.md");
    expect(listed.total).toBe(0);
    expect(readFileSync(nodePath.join(root, "plan.md"), "utf-8")).toBe("plain\n");
    expect(existsSync(nodePath.join(root, ".inteligir"))).toBe(false);
  });

  it("refuses an id that cannot name a file rather than escaping the store's folder", async () => {
    const { root, annotations } = boot();
    writeFileSync(nodePath.join(root, "plan.md"), "---\nid: ../escape\n---\nnote\n");
    expect(
      await refusalCode(
        annotations.add({ id: "c1", path: "plan.md", quote: "the passage", text: "x" }),
      ),
    ).toBe("refused");
  });

  it("refuses rather than overwrites an id that is not text, naming it", async () => {
    const { root, annotations } = boot();
    const numbered = "---\nid: 42\n---\nnote\n";
    writeFileSync(nodePath.join(root, "plan.md"), numbered);
    await expect(
      annotations.add({ id: "c1", path: "plan.md", quote: "the passage", text: "x" }),
    ).rejects.toThrow(/frontmatter id 42 is not text/u);
    expect(readFileSync(nodePath.join(root, "plan.md"), "utf-8")).toBe(numbered);
    expect(existsSync(nodePath.join(root, ".inteligir"))).toBe(false);
  });

  it("annotations follow the note through a rename", async () => {
    const { root, vault, annotations } = boot();
    writeFileSync(nodePath.join(root, "plan.md"), "%%i:c1:start%%x%%i:c1:end%%\n");
    await annotations.add({ id: "c1", path: "plan.md", quote: "the passage", text: "root" });
    await vault.rename("plan.md", "renamed.md");
    const listed = await annotations.list("renamed.md");
    expect(listed.total).toBe(1);
    expect(listed.annotations[0]?.state).toBe("anchored");
  });

  it("calls a root the body never marks missing, and flags orphan markers", async () => {
    const { root, annotations } = boot();
    writeFileSync(
      nodePath.join(root, "plan.md"),
      "A %%i:ghost:start%%range%%i:ghost:end%% here.\n",
    );
    await annotations.add({
      id: "unanchored",
      path: "plan.md",
      quote: "the passage",
      text: "floating",
    });
    const listed = await annotations.list("plan.md");
    expect(listed.annotations[0]?.state).toBe("missing");
    expect(listed.orphanMarkers).toEqual(["ghost"]);
  });

  it("calls an unmarked root on a stub waiting, since the stub's fill will place it", async () => {
    const { root, annotations } = boot();
    writeFileSync(
      nodePath.join(root, "stub.md"),
      [
        "---",
        "id: 0e5b3c1a-9a51-4f0e-8a0c-0b7f9d3a2c11",
        "kind: link",
        "url: https://stephango.com/file-over-app",
        "saved: 2026-10-17T09:12:30Z",
        "---",
        "",
      ].join("\n"),
    );
    const { answer } = await annotations.add({
      id: "w1",
      path: "stub.md",
      quote: "file over app",
      text: "",
    });
    expect(answer.annotations.map(({ id, state }) => ({ id, state }))).toEqual([
      { id: "w1", state: "waiting" },
    ]);
  });

  it("remove deletes the whole chain and answers which ids died", async () => {
    const { root, annotations } = boot();
    writeFileSync(nodePath.join(root, "plan.md"), "%%i:c1:start%%x%%i:c1:end%%\n");
    await annotations.add({ id: "c1", path: "plan.md", quote: "the passage", text: "root" });
    await annotations.reply({ id: "r1", parentId: "c1", path: "plan.md", text: "reply" });
    const { answer: removed } = await annotations.remove({
      id: "c1",
      path: "plan.md",
      stripMarkers: false,
    });
    expect(removed.removedIds.toSorted()).toEqual(["c1", "r1"]);
    expect(removed.total).toBe(0);
    expect(storeRaw(root, "plan.md")).toBe("{}\n");
  });

  it("add against a missing note refuses; list still answers", async () => {
    const { annotations } = boot();
    await expect(
      annotations.add({ id: "c1", path: "absent.md", quote: "the passage", text: "x" }),
    ).rejects.toThrow();
    const listed = await annotations.list("absent.md");
    expect(listed.total).toBe(0);
  });

  it("signs an entry with the source the caller states, and `user` when it states none", async () => {
    const { root, annotations } = boot();
    writeFileSync(nodePath.join(root, "plan.md"), "note\n");
    await annotations.add({
      id: "a1",
      path: "plan.md",
      quote: "the passage",
      source: "agent",
      text: "from the agent",
    });
    await annotations.reply({ id: "a1-r1", parentId: "a1", path: "plan.md", text: "silent" });
    await annotations.reply({
      id: "a1-r2",
      parentId: "a1",
      path: "plan.md",
      source: "external",
      text: "scripted",
    });
    const { answer: edited } = await annotations.edit({
      id: "a1-r2",
      path: "plan.md",
      text: "rewritten",
    });
    const [annotation] = edited.annotations;
    expect(annotation?.root.source).toBe("agent");
    expect(annotation?.replies.map((reply) => reply.entry.source)).toEqual(["user", "user"]);
  });
});

describe("what a call wrote", () => {
  it("names the note it minted an id into and the store, and only what it wrote", async () => {
    const { root, annotations } = boot();
    writeFileSync(nodePath.join(root, "plan.md"), "The %%i:c1:start%%plan%%i:c1:end%%.\n");

    const added = await annotations.add({
      id: "c1",
      path: "plan.md",
      quote: "the passage",
      text: "why?",
    });
    const storePath = storePathOf(root, "plan.md");
    expect(added.wrote).toEqual(["plan.md", storePath]);

    const replied = await annotations.reply({
      id: "r1",
      parentId: "c1",
      path: "plan.md",
      text: "so",
    });
    expect(replied.wrote).toEqual([storePath]);
  });
});

describe("an unparseable store", () => {
  it("is reported by its own name and left, and the edit is refused", async () => {
    const { root, annotations } = boot();
    writeFileSync(nodePath.join(root, "plan.md"), WITH_ID);
    const store = nodePath.join(root, annotationsStorePath(NOTE_ID));
    mkdirSync(nodePath.dirname(store), { recursive: true });
    writeFileSync(store, "{broken");
    expect(
      await refusalCode(
        annotations.add({ id: "c1", path: "plan.md", quote: "the passage", text: "x" }),
      ),
    ).toBe("invalid");
    await expect(annotations.list("plan.md")).rejects.toThrow(annotationsStorePath(NOTE_ID));
    expect(readFileSync(store, "utf-8")).toBe("{broken");
  });
});

describe("a file beside the note named like an annotation store", () => {
  it("is the user's own: a list reads nothing from it and leaves it as found", async () => {
    const { root, annotations } = boot();
    writeFileSync(nodePath.join(root, "plan.md"), "note\n");
    const beside = nodePath.join(root, "plan.md.annotations.json");
    writeFileSync(
      beside,
      serializeAnnotationStore({ m1: { createdAt: AT, text: "mine", updatedAt: AT } }),
    );

    const listed = await annotations.list("plan.md");

    expect(listed.total).toBe(0);
    expect(existsSync(beside)).toBe(true);
    expect(readFileSync(nodePath.join(root, "plan.md"), "utf-8")).toBe("note\n");
  });
});

describe("the store write is a compare-and-swap", () => {
  const STORE = annotationsStorePath(NOTE_ID);
  const OTHER: AnnotationStore = {
    theirs: {
      createdAt: AT,
      source: "agent",
      text: "landed between read and write",
      updatedAt: AT,
    },
  };

  const bootWithStore = (landing: readonly AnnotationStore[], seeded: boolean) => {
    const { root, vault } = boot();
    writeFileSync(nodePath.join(root, "plan.md"), WITH_ID);
    if (seeded) {
      mkdirSync(nodePath.join(root, ".inteligir", "annotations"), { recursive: true });
      writeFileSync(nodePath.join(root, STORE), serializeAnnotationStore({}));
    }
    const raced = racedVault({ landing, root, storePath: STORE, vault });
    return {
      annotations: createAnnotationsService({
        knowledge: NO_KNOWLEDGE,
        now: () => AT,
        service: raced,
      }),
      root,
    };
  };

  it("keeps an entry that landed between the read and the write, by re-folding over it", async () => {
    const { root, annotations } = bootWithStore([OTHER], true);

    const { answer } = await annotations.add({
      id: "ours",
      path: "plan.md",
      quote: "the passage",
      text: "ours",
    });

    expect(answer.annotations.map((annotation) => annotation.id).toSorted()).toEqual([
      "ours",
      "theirs",
    ]);
    expect(Object.keys(storeOnDisk(root, "plan.md")).toSorted()).toEqual(["ours", "theirs"]);
  });

  it("creates the store only if none appeared since the read said so", async () => {
    const { root, annotations } = bootWithStore([OTHER], false);

    await annotations.add({ id: "ours", path: "plan.md", quote: "the passage", text: "ours" });

    expect(Object.keys(storeOnDisk(root, "plan.md")).toSorted()).toEqual(["ours", "theirs"]);
  });

  it("refuses as a conflict, writing nothing, when the file moves under both attempts", async () => {
    const another: AnnotationStore = {
      more: { createdAt: AT, source: "agent", text: "and again under the retry", updatedAt: AT },
    };
    const { root, annotations } = bootWithStore([OTHER, another], true);

    expect(
      await refusalCode(
        annotations.add({ id: "ours", path: "plan.md", quote: "the passage", text: "ours" }),
      ),
    ).toBe("conflict");
    expect(Object.keys(storeOnDisk(root, "plan.md")).toSorted()).toEqual(["more", "theirs"]);
  });

  it("re-judges the edit against what the retry read, so a taken id is refused rather than re-applied", async () => {
    const taken: AnnotationStore = {
      ours: { createdAt: AT, source: "agent", text: "the other writer used our id", updatedAt: AT },
    };
    const { root, annotations } = bootWithStore([taken], true);

    await expect(
      annotations.add({ id: "ours", path: "plan.md", quote: "the passage", text: "ours" }),
    ).rejects.toThrow(/already exists/u);
    expect(storeOnDisk(root, "plan.md").ours?.text).toBe("the other writer used our id");
  });
});

describe("roots stored before the item's text can hold them", () => {
  const STUB_ID = "0e5b3c1a-9a51-4f0e-8a0c-0b7f9d3a2c11";
  const STUB = [
    "---",
    `id: ${STUB_ID}`,
    "kind: link",
    "url: https://stephango.com/file-over-app",
    "saved: 2026-10-17T09:12:30Z",
    "---",
    "",
  ].join("\n");

  it("creates the store by the item's id, keeps each quote and date, and adds an id only once", async () => {
    const { root, annotations } = boot();
    writeFileSync(nodePath.join(root, "stub.md"), STUB);
    const entry = {
      createdAt: AT - 60,
      id: "h1",
      quote: "file over app",
      source: "external" as const,
      text: "",
    };

    const first = await annotations.addUnanchored({ entries: [entry], itemId: STUB_ID });
    expect(first).toEqual({
      answer: { path: annotationsStorePath(STUB_ID) },
      wrote: [annotationsStorePath(STUB_ID)],
    });
    await annotations.addUnanchored({
      entries: [
        { ...entry, text: "again" },
        { ...entry, id: "h2", quote: "apps are ephemeral" },
      ],
      itemId: STUB_ID,
    });

    const listed = await annotations.list("stub.md");
    expect(
      listed.annotations.map(({ id, quote, root: entryRoot, state }) => ({
        createdAt: entryRoot.createdAt,
        id,
        quote,
        state,
        text: entryRoot.text,
      })),
    ).toEqual([
      { createdAt: AT - 60, id: "h1", quote: "file over app", state: "waiting", text: "" },
      { createdAt: AT - 60, id: "h2", quote: "apps are ephemeral", state: "waiting", text: "" },
    ]);
  });

  it("refuses an item id that cannot name a store", async () => {
    const { annotations } = boot();
    expect(await refusalCode(annotations.addUnanchored({ entries: [], itemId: "../escape" }))).toBe(
      "refused",
    );
  });
});
