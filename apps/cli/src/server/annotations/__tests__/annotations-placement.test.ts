import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import nodePath from "node:path";
import { describe, expect, it } from "vitest";

import {
  annotationsStorePath,
  serializeAnnotationStore,
} from "@repo/notes/annotations/store-schema";

import { identityLock } from "../../__tests__/identity-lock";
import { ignoreFromDisk } from "../../__tests__/ignore-from-disk";
import { makeTempDir } from "../../__tests__/temp-dir";
import { createVaultService } from "../../vault/vault-service";
import type { VaultService } from "../../vault/vault-service";
import { AnnotationsError, createAnnotationsService } from "../annotations-service";
import type { AnnotationsErrorCode } from "../annotations-service";

const AT = 1_707_900_000;
const ITEM_ID = "0f6a3b1e-5c2d-4e8f-9a7b-1c3d5e7f9a0b";
const STORE = annotationsStorePath(ITEM_ID);
const NOTE = `---\nid: ${ITEM_ID}\n---\n\nFile over app is a philosophy. Files last.\n`;
const STUB = [
  "---",
  `id: ${ITEM_ID}`,
  "kind: link",
  "url: https://stephango.com/file-over-app",
  "saved: 2026-10-17T09:12:30Z",
  "---",
  "",
].join("\n");

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

// every guarded write of the note first lands the next of `edits` on disk under it, as another
// writer would; writes past the list run clean
const racingNote = (vault: VaultService, root: string, edits: string[]): VaultService => ({
  ...vault,
  async writeIfUnchanged(path, expected, content) {
    const edit = path === "item.md" ? edits.shift() : undefined;
    if (edit !== undefined) {
      writeFileSync(nodePath.join(root, path), edit);
    }
    return await vault.writeIfUnchanged(path, expected, content);
  },
});

const boot = (options: { note: string; edits?: string[] }) => {
  const root = nodePath.join(makeTempDir("inteligir-placement-"), "vault");
  mkdirSync(root, { recursive: true });
  writeFileSync(nodePath.join(root, "item.md"), options.note);
  const vault = createVaultService({ ignore: ignoreFromDisk(root), lock: identityLock, root });
  const annotations = createAnnotationsService({
    knowledge: { pathForNoteId: async () => await Promise.resolve(null) },
    now: () => AT,
    service: racingNote(vault, root, options.edits ?? []),
  });
  const note = (): string => readFileSync(nodePath.join(root, "item.md"), "utf-8");
  const store = (): string | null =>
    existsSync(nodePath.join(root, STORE))
      ? readFileSync(nodePath.join(root, STORE), "utf-8")
      : null;
  const seedStore = (entries: Parameters<typeof serializeAnnotationStore>[0]): void => {
    mkdirSync(nodePath.dirname(nodePath.join(root, STORE)), { recursive: true });
    writeFileSync(nodePath.join(root, STORE), serializeAnnotationStore(entries));
  };
  return { annotations, note, root, seedStore, store };
};

describe("add with a place", () => {
  it("writes the entry, then the markers around the passage, and lists it anchored", async () => {
    const { annotations, note, store } = boot({ note: NOTE });
    const { answer, wrote } = await annotations.add({
      id: "h1",
      path: "item.md",
      place: { occurrence: 1 },
      quote: "a philosophy",
      text: "Worth a read",
    });
    expect(note()).toBe(
      `---\nid: ${ITEM_ID}\n---\n\nFile over app is %%i:h1:start%%a philosophy%%i:h1:end%%. Files last.\n`,
    );
    expect(JSON.parse(store() ?? "{}")).toMatchObject({
      h1: { quote: "a philosophy", text: "Worth a read" },
    });
    expect(wrote.toSorted()).toEqual([STORE, "item.md"].toSorted());
    expect(answer.annotations).toMatchObject([
      { id: "h1", passage: "a philosophy", quote: "a philosophy", state: "anchored" },
    ]);
  });

  it("refuses a passage the text does not hold, writing nothing", async () => {
    const { annotations, note, store } = boot({ note: NOTE });
    expect(
      await refusalCode(
        annotations.add({
          id: "h1",
          path: "item.md",
          place: { occurrence: 1 },
          quote: "not in it",
          text: "",
        }),
      ),
    ).toBe("passage-not-found");
    expect(
      await refusalCode(
        annotations.add({
          id: "h1",
          path: "item.md",
          place: { occurrence: 2 },
          quote: "File over app",
          text: "",
        }),
      ),
    ).toBe("passage-not-found");
    expect(note()).toBe(NOTE);
    expect(store()).toBeNull();
  });

  it("retries once when the note changed under the markers' write", async () => {
    const edited = NOTE.replace("Files last.", "Files last. Apps do not.");
    const { annotations, note } = boot({ edits: [edited], note: NOTE });
    await annotations.add({
      id: "h1",
      path: "item.md",
      place: { occurrence: 1 },
      quote: "Files last",
      text: "",
    });
    expect(note()).toBe(edited.replace("Files last", "%%i:h1:start%%Files last%%i:h1:end%%"));
  });

  it("refuses when the note changed under both writes, and takes the entry back out", async () => {
    const { annotations, note, store } = boot({
      edits: [`${NOTE}one\n`, `${NOTE}two\n`],
      note: NOTE,
    });
    expect(
      await refusalCode(
        annotations.add({
          id: "h1",
          path: "item.md",
          place: { occurrence: 1 },
          quote: "Files last",
          text: "",
        }),
      ),
    ).toBe("conflict");
    expect(note()).toBe(`${NOTE}two\n`);
    expect(JSON.parse(store() ?? "{}")).toEqual({});
  });
});

describe("remove with its markers", () => {
  it("strips the removed ids' markers, keeping another id on a shared pair", async () => {
    const marked = `---\nid: ${ITEM_ID}\n---\n\nFile over app is %%i:a1,b2:start%%a philosophy%%i:a1,b2:end%%.\n`;
    const { annotations, note, seedStore } = boot({ note: marked });
    seedStore({
      a1: { createdAt: AT, quote: "a philosophy", text: "", updatedAt: AT },
      b2: { createdAt: AT, quote: "a philosophy", text: "", updatedAt: AT },
      r1: { createdAt: AT, parentId: "a1", text: "reply", updatedAt: AT },
    });
    const { answer, wrote } = await annotations.remove({
      id: "a1",
      path: "item.md",
      stripMarkers: true,
    });
    expect(note()).toBe(marked.replaceAll("a1,b2", "b2"));
    expect(answer.removedIds.toSorted()).toEqual(["a1", "r1"]);
    expect(answer.annotations.map(({ id, state }) => ({ id, state }))).toEqual([
      { id: "b2", state: "anchored" },
    ]);
    expect(wrote.toSorted()).toEqual([STORE, "item.md"].toSorted());
  });

  it("leaves the text alone without stripMarkers", async () => {
    const marked = `---\nid: ${ITEM_ID}\n---\n\n%%i:a1:start%%x%%i:a1:end%%\n`;
    const { annotations, note, seedStore } = boot({ note: marked });
    seedStore({ a1: { createdAt: AT, quote: "x", text: "", updatedAt: AT } });
    await annotations.remove({ id: "a1", path: "item.md", stripMarkers: false });
    expect(note()).toBe(marked);
  });
});

describe("placing the waiting highlights", () => {
  it("places each waiting root's quote into the content it is handed, oldest first, writing nothing", async () => {
    const { annotations, note, seedStore } = boot({ note: STUB });
    seedStore({
      later: { createdAt: AT + 1, quote: "Files last", text: "", updatedAt: AT + 1 },
      older: { createdAt: AT, quote: "a philosophy", text: "", updatedAt: AT },
      reply: { createdAt: AT, parentId: "older", text: "a reply", updatedAt: AT },
    });
    const filled = `${STUB}\nFile over app is a philosophy. Files last.\n`;
    const placed = await annotations.placeWaiting({
      content: filled,
      final: false,
      itemId: ITEM_ID,
      path: "item.md",
    });
    expect(placed.placed).toEqual(["older", "later"]);
    expect(placed.content).toBe(
      `${STUB}\nFile over app is %%i:older:start%%a philosophy%%i:older:end%%. %%i:later:start%%Files last%%i:later:end%%.\n`,
    );
    expect(note()).toBe(STUB);
  });

  it("puts what found no passage under Highlights when final", async () => {
    const { annotations, seedStore } = boot({ note: STUB });
    seedStore({
      gone: { createdAt: AT, quote: "a passage the page lost", text: "", updatedAt: AT },
    });
    const placed = await annotations.placeWaiting({
      content: `${STUB}\nThe page's text.\n`,
      final: true,
      itemId: ITEM_ID,
      path: "item.md",
    });
    expect(placed.placed).toEqual(["gone"]);
    expect(placed.content).toBe(
      `${STUB}\nThe page's text.\n\n## Highlights\n\n> %%i:gone:start%%a passage the page lost%%i:gone:end%%\n`,
    );
  });

  it("places only the roots it is asked to, leaving the rest unplaced", async () => {
    const { annotations, seedStore } = boot({ note: STUB });
    seedStore({
      fresh: { createdAt: AT + 1, quote: "a new selection", text: "", updatedAt: AT + 1 },
      removed: { createdAt: AT, quote: "a passage taken out", text: "", updatedAt: AT },
    });
    const placed = await annotations.placeWaiting({
      content: `${STUB}\nThe page's text.\n`,
      final: true,
      itemId: ITEM_ID,
      only: ["fresh"],
      path: "item.md",
    });
    expect(placed.placed).toEqual(["fresh"]);
    expect(placed.content).toBe(
      `${STUB}\nThe page's text.\n\n## Highlights\n\n> %%i:fresh:start%%a new selection%%i:fresh:end%%\n`,
    );
  });

  it("places nothing for an item with no id, no store or a store that does not parse", async () => {
    const { annotations, root } = boot({ note: STUB });
    const content = `${STUB}\nText.\n`;
    expect(
      await annotations.placeWaiting({ content, final: true, itemId: null, path: "item.md" }),
    ).toEqual({ content, placed: [] });
    expect(
      await annotations.placeWaiting({ content, final: true, itemId: ITEM_ID, path: "item.md" }),
    ).toEqual({ content, placed: [] });
    mkdirSync(nodePath.dirname(nodePath.join(root, STORE)), { recursive: true });
    writeFileSync(nodePath.join(root, STORE), "{not json");
    expect(
      await annotations.placeWaiting({ content, final: true, itemId: ITEM_ID, path: "item.md" }),
    ).toEqual({ content, placed: [] });
  });
});
