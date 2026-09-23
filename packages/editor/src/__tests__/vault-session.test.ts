import type { VaultChangedEvent, VaultEntry } from "@repo/editor/host-io";
import type { OpenPathChange } from "@repo/editor/note/open-note-store";
import { createVaultSession } from "@repo/editor/note/vault-session";
import type {
  RenameResult,
  VanishedChoice,
  VaultSessionPorts,
} from "@repo/editor/note/vault-session";
import type { VaultEditorState } from "@repo/editor/vault-editor";
import { describe, expect, it } from "vitest";
import { FakeVault } from "./fake-vault";

// every step the session takes is a promise over the fake's microtasks, so hops drain them all.
const settle = async (): Promise<void> => {
  for (let i = 0; i < 50; i += 1) {
    await Promise.resolve();
  }
};

const doc = (path: string): VaultEntry => ({ kind: "doc", name: path, path });

interface HarnessOptions {
  readonly files?: Readonly<Record<string, string>>;
  readonly openAtBoot?: string;
  // the boot answers once this settles, so a test can act while it is in flight.
  readonly bootGate?: Promise<void>;
  readonly refuseRename?: string;
  readonly vanishedChoice?: VanishedChoice;
}

// The disk is the fake vault: `list` walks it, so a test moves a file there and announces it.
// `log` orders what reached the host — writes, renames and open paths — across every port.
const harness = (options: HarnessOptions = {}) => {
  const vault = new FakeVault();
  for (const [path, content] of Object.entries(options.files ?? {})) {
    vault.files.set(path, content);
  }
  const log: string[] = [];
  const notices: string[] = [];
  const asked: string[] = [];
  const listings: VaultEntry[][] = [];
  const opened: [string | null, OpenPathChange][] = [];
  let lists = 0;
  let editor: VaultEditorState | null = null;
  // the server's broadcast, wired to the session once it exists.
  let broadcast: ((event: VaultChangedEvent) => void) | null = null;

  const { write } = vault;
  vault.write = async (path, content) => {
    log.push(`write ${path}`);
    return await write(path, content);
  };
  const walk = (): VaultEntry[] => [...vault.files.keys()].map(doc);

  const rename = async (from: string, to: string): Promise<RenameResult> => {
    log.push(`rename ${from} -> ${to}`);
    await Promise.resolve();
    if (options.refuseRename !== undefined) {
      return { error: options.refuseRename, ok: false };
    }
    const moved = [...vault.files].filter(([path]) => path === from || path.startsWith(`${from}/`));
    for (const [path, content] of moved) {
      vault.files.delete(path);
      vault.files.set(`${to}${path.slice(from.length)}`, content);
    }
    // the move's own broadcast can land, and be acted on, before its answer does.
    broadcast?.({ kind: "files", paths: [from, to] });
    await settle();
    return { ok: true };
  };

  const ports: VaultSessionPorts = {
    askVanished: async (path) => {
      asked.push(path);
      return options.vanishedChoice ?? "discard";
    },
    boot: async () => {
      await options.bootGate;
      const { openAtBoot } = options;
      const content = openAtBoot === undefined ? undefined : vault.files.get(openAtBoot);
      return {
        entries: walk(),
        openNote:
          openAtBoot === undefined || content === undefined ? null : { content, path: openAtBoot },
      };
    },
    exists: async (path) => await Promise.resolve(vault.files.has(path)),
    list: async () => {
      lists += 1;
      return await Promise.resolve(walk());
    },
    note: vault,
    notify: (message) => {
      notices.push(message);
    },
    publishEditor: (state) => {
      editor = state;
    },
    publishListing: (entries) => {
      listings.push(entries);
    },
    publishOpenPath: (path, change) => {
      log.push(`open ${path ?? "nothing"}`);
      opened.push([path, change]);
    },
    rename,
  };
  const session = createVaultSession(ports);
  broadcast = session.handleVaultChanged;
  return {
    asked,
    editor: () => editor,
    listings,
    lists: () => lists,
    log,
    notices,
    opened,
    session,
    vault,
  };
};

const started = async (options: HarnessOptions = {}) => {
  const h = harness(options);
  await h.session.start();
  await settle();
  h.log.length = 0;
  return h;
};

const TWO_NOTES: HarnessOptions = { files: { "a.md": "A", "b.md": "B" }, openAtBoot: "a.md" };

describe("createFileAt", () => {
  it("creates a genuinely new note through the port's create, never its write", async () => {
    const { session, vault, notices } = await started();
    await expect(session.actions.createFileAt("Fresh", "# Fresh\n")).resolves.toBe("Fresh.md");
    expect(vault.files.get("Fresh.md")).toBe("# Fresh\n");
    expect(vault.writes).toBe(0);
    expect(notices).toEqual([]);
  });

  it("opens a note that already exists without writing anything", async () => {
    const { session, vault } = await started({ files: { "Fresh.md": "kept" } });
    await expect(session.actions.createFileAt("Fresh", "# Fresh\n")).resolves.toBe("Fresh.md");
    expect(vault.files.get("Fresh.md")).toBe("kept");
    expect(vault.writes).toBe(0);
  });

  it("reports a refused create instead of opening a note that was not made", async () => {
    const { session, vault, notices } = await started();
    vault.create = async () => await Promise.reject(new Error("A file already exists at Fresh.md"));
    await expect(session.actions.createFileAt("Fresh")).resolves.toBeNull();
    expect(notices).toEqual(["Couldn't create Fresh.md."]);
  });
});

describe("switching notes", () => {
  it("writes the note being left before it publishes the next one", async () => {
    const { session, vault, log } = await started(TWO_NOTES);
    session.actions.editNote("a.md", "A typed");
    session.actions.openFile("b.md");
    await settle();
    expect(log).toEqual(["write a.md", "open b.md"]);
    expect(vault.files.get("a.md")).toBe("A typed");
  });

  it("stays on a note whose write was refused, and says so", async () => {
    const { session, vault, log, notices, editor } = await started(TWO_NOTES);
    vault.write = async () => await Promise.reject(new Error("disk full"));
    session.actions.editNote("a.md", "A typed");
    session.actions.openFile("b.md");
    await settle();
    expect(notices).toEqual([
      "Couldn't save a.md: disk full. Retrying.",
      "Couldn't save the current file — resolve that before switching.",
    ]);
    expect(log).toEqual([]);
    expect(editor()).toMatchObject({ content: "A typed", dirty: true, path: "a.md" });
    session.stop();
  });

  it("stays on the note when it is opened again while the switch away waits on its write", async () => {
    const { session, vault, log, editor } = await started(TWO_NOTES);
    vault.manualWrite = true;
    session.actions.editNote("a.md", "A typed");
    session.actions.openFile("b.md");
    await settle();
    session.actions.openFile("a.md");
    vault.pendingWrites[0]?.resolve();
    await settle();
    expect(log).toEqual(["write a.md"]);
    expect(editor()).toMatchObject({ content: "A typed", dirty: false, path: "a.md" });
  });

  it("asks about a note deleted under unsaved edits, and lets them go when told to", async () => {
    const { session, vault, log, asked } = await started(TWO_NOTES);
    vault.files.delete("a.md");
    session.actions.editNote("a.md", "A typed");
    session.actions.openFile("b.md");
    await settle();
    expect(asked).toEqual(["a.md"]);
    expect(log).toEqual(["write a.md", "open b.md"]);
    expect(vault.files.has("a.md")).toBe(false);
  });

  it("writes a deleted note back from its buffer when told to re-create it", async () => {
    const { session, vault, log, asked } = await started({
      ...TWO_NOTES,
      vanishedChoice: "recreate",
    });
    vault.files.delete("a.md");
    session.actions.editNote("a.md", "A typed");
    session.actions.openFile("b.md");
    await settle();
    expect(asked).toEqual(["a.md"]);
    expect(vault.files.get("a.md")).toBe("A typed");
    expect(log).toEqual(["write a.md", "open b.md"]);
  });
});

describe("a failed save", () => {
  it("says so once, however many times it is retried", async () => {
    const { session, vault, notices, editor } = await started(TWO_NOTES);
    vault.write = async () => await Promise.reject(new Error("disk full"));
    session.actions.editNote("a.md", "A typed");
    await expect(session.actions.flush()).resolves.toBe(false);
    await expect(session.actions.flush()).resolves.toBe(false);
    expect(notices).toEqual(["Couldn't save a.md: disk full. Retrying."]);
    expect(editor()).toMatchObject({
      dirty: true,
      saveError: { kind: "refused", message: "disk full" },
    });
    session.stop();
  });

  it("names a note deleted under its edits rather than retrying it", async () => {
    const { session, vault, notices, editor } = await started(TWO_NOTES);
    vault.files.delete("a.md");
    session.actions.editNote("a.md", "A typed");
    await expect(session.actions.flush()).resolves.toBe(false);
    expect(notices).toEqual(["a.md was deleted elsewhere, and its edits are not saved."]);
    expect(editor()).toMatchObject({ saveError: { kind: "vanished" } });
  });
});

describe("renaming the open note", () => {
  it("writes it, lets go of it for the move, then carries it to the new path", async () => {
    const { session, vault, log, opened } = await started(TWO_NOTES);
    session.actions.editNote("a.md", "A typed");
    await expect(session.actions.renameEntry("a.md", "c.md")).resolves.toBe(true);
    await settle();
    // held on `a.md` through the move, the note would have read its own broadcast as a vanish.
    expect(log).toEqual(["write a.md", "rename a.md -> c.md", "open c.md"]);
    expect(opened.at(-1)).toEqual(["c.md", "carry"]);

    session.actions.editNote("c.md", "C typed");
    await expect(session.actions.flush()).resolves.toBe(true);
    expect(vault.files.get("c.md")).toBe("C typed");
  });

  it("re-attaches the note when the rename is refused, and says why", async () => {
    const { session, vault, log, notices, editor } = await started({
      ...TWO_NOTES,
      refuseRename: "A file already exists at c.md",
    });
    session.actions.editNote("a.md", "A typed");
    await expect(session.actions.renameEntry("a.md", "c.md")).resolves.toBe(false);
    await settle();
    expect(notices).toEqual(["A file already exists at c.md"]);
    expect(log).toEqual(["write a.md", "rename a.md -> c.md"]);
    expect(editor()).toMatchObject({ content: "A typed", dirty: false, path: "a.md" });

    session.actions.editNote("a.md", "A typed more");
    await expect(session.actions.flush()).resolves.toBe(true);
    expect(vault.files.get("a.md")).toBe("A typed more");
  });

  it("writes a keystroke typed while its write is in flight before it lets go of the note", async () => {
    const { session, vault, log } = await started(TWO_NOTES);
    vault.manualWrite = true;
    session.actions.editNote("a.md", "A typed");
    const renaming = session.actions.renameEntry("a.md", "c.md");
    await settle();
    session.actions.editNote("a.md", "A typed more");
    vault.manualWrite = false;
    vault.pendingWrites[0]?.resolve();
    await expect(renaming).resolves.toBe(true);
    await settle();
    expect(log).toEqual(["write a.md", "write a.md", "rename a.md -> c.md", "open c.md"]);
    expect(vault.files.get("c.md")).toBe("A typed more");
  });

  it("carries the note when a folder above it is renamed", async () => {
    const { session, vault, log, opened } = await started({
      files: { "b.md": "B", "notes/plans/a.md": "A" },
      openAtBoot: "notes/plans/a.md",
    });
    session.actions.editNote("notes/plans/a.md", "A typed");
    await expect(session.actions.renameEntry("notes/plans", "notes/roadmap")).resolves.toBe(true);
    await settle();
    expect(log).toEqual([
      "write notes/plans/a.md",
      "rename notes/plans -> notes/roadmap",
      "open notes/roadmap/a.md",
    ]);
    expect(opened.at(-1)).toEqual(["notes/roadmap/a.md", "carry"]);

    session.actions.editNote("notes/roadmap/a.md", "A typed more");
    await expect(session.actions.flush()).resolves.toBe(true);
    expect(vault.files.get("notes/roadmap/a.md")).toBe("A typed more");
  });

  it("is not fooled by a folder whose name is a prefix of the open note's", async () => {
    const { session, log } = await started({
      files: { "notes/plan.md": "P", "notes/plans/a.md": "A" },
      openAtBoot: "notes/plans/a.md",
    });
    await expect(session.actions.renameEntry("notes/plan", "notes/old")).resolves.toBe(true);
    await settle();
    expect(log).toEqual(["rename notes/plan -> notes/old"]);
  });
});

describe("deleting", () => {
  it("closes the open note it deletes", async () => {
    const { session, vault, log, notices } = await started(TWO_NOTES);
    await session.actions.deleteEntry("a.md");
    expect(log).toEqual(["open nothing"]);
    expect(vault.files.has("a.md")).toBe(false);
    expect(notices).toEqual([]);
  });

  it("leaves the open note alone when another note goes", async () => {
    const { session, vault, log, editor } = await started(TWO_NOTES);
    await session.actions.deleteEntry("b.md");
    expect(log).toEqual([]);
    expect(vault.files.has("b.md")).toBe(false);
    expect(editor()).toMatchObject({ path: "a.md" });
  });

  it("keeps the note open when the delete fails, and says so", async () => {
    const { session, vault, log, notices, editor } = await started(TWO_NOTES);
    vault.remove = async () => await Promise.reject(new Error("offline"));
    await session.actions.deleteEntry("a.md");
    expect(notices).toEqual(["Couldn't delete a.md."]);
    expect(log).toEqual([]);
    expect(editor()).toMatchObject({ content: "A", path: "a.md" });
  });

  const IN_FOLDER: HarnessOptions = {
    files: { "b.md": "B", "notes/a.md": "A" },
    openAtBoot: "notes/a.md",
  };

  it("closes the open note when the folder holding it goes", async () => {
    const { session, vault, log, notices } = await started(IN_FOLDER);
    await session.actions.deleteEntry("notes");
    expect(log).toEqual(["open nothing"]);
    expect(vault.files.has("notes/a.md")).toBe(false);
    expect(notices).toEqual([]);
  });

  it("keeps the note open, its edits written, when the delete of its folder fails", async () => {
    const { session, vault, log, notices, editor } = await started(IN_FOLDER);
    vault.remove = async () => await Promise.reject(new Error("offline"));
    session.actions.editNote("notes/a.md", "A typed");
    await session.actions.deleteEntry("notes");
    expect(notices).toEqual(["Couldn't delete notes."]);
    expect(log).toEqual(["write notes/a.md"]);
    expect(editor()).toMatchObject({ content: "A typed", dirty: false, path: "notes/a.md" });
  });
});

describe("a vault change", () => {
  it("re-lists when a known path leaves the vault, so the resolver loses it", async () => {
    const { session, vault, listings } = await started({ files: { "a.md": "A", "b.md": "B" } });
    vault.files.delete("b.md");
    session.handleVaultChanged({ kind: "files", paths: ["b.md"] });
    await settle();
    expect(listings).toEqual([[doc("a.md"), doc("b.md")], [doc("a.md")]]);
  });

  it("walks the vault once for a files event however many paths it names", async () => {
    const { session, lists } = await started(TWO_NOTES);
    const paths = Array.from({ length: 30 }, (_, index) => `n${index}.md`);
    session.handleVaultChanged({ kind: "files", paths });
    await settle();
    expect(lists()).toBe(1);
  });

  it("reloads the open note on a content event that names it, and walks nothing", async () => {
    const { session, vault, lists, editor } = await started(TWO_NOTES);
    vault.files.set("a.md", "A external");
    session.handleVaultChanged({ kind: "content", path: "a.md" });
    await settle();
    expect(editor()).toMatchObject({ content: "A external", dirty: false });
    expect(lists()).toBe(0);
  });

  it("leaves the open note alone on a content event for another note", async () => {
    const { session, vault, editor } = await started(TWO_NOTES);
    vault.files.set("a.md", "A external");
    session.handleVaultChanged({ kind: "content", path: "b.md" });
    await settle();
    expect(editor()).toMatchObject({ content: "A" });
  });

  it("re-checks the open note and the listing when nobody could name the paths", async () => {
    const { session, vault, lists, editor } = await started(TWO_NOTES);
    vault.files.set("a.md", "A external");
    session.handleVaultChanged({ kind: "files", paths: null });
    await settle();
    expect(editor()).toMatchObject({ content: "A external" });
    expect(lists()).toBe(1);
  });
});

describe("starting and stopping", () => {
  it("lets a note opened while the boot is in flight win over the boot's note", async () => {
    const gate: PromiseWithResolvers<void> = Promise.withResolvers();
    const { session, opened } = harness({ ...TWO_NOTES, bootGate: gate.promise });
    const booting = session.start();
    session.actions.openFile("b.md");
    await settle();
    gate.resolve();
    await booting;
    await settle();
    expect(opened).toEqual([["b.md", "navigate"]]);
  });

  it("applies nothing when the boot answers after the session stopped", async () => {
    const gate: PromiseWithResolvers<void> = Promise.withResolvers();
    const { session, opened, listings } = harness({ ...TWO_NOTES, bootGate: gate.promise });
    const booting = session.start();
    session.stop();
    gate.resolve();
    await booting;
    await settle();
    expect(listings).toEqual([]);
    expect(opened).toEqual([]);
  });

  it("writes an edit still inside the autosave debounce when it stops", async () => {
    const { session, vault } = await started(TWO_NOTES);
    session.actions.editNote("a.md", "A typed");
    session.stop();
    await settle();
    expect(vault.files.get("a.md")).toBe("A typed");
  });
});
