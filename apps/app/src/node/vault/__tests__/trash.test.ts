import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VaultPathError } from "@repo/notes/knowledge/vault-path";
import {
  listTrash,
  purgeTrashedNote,
  restoreNote,
  sweepExpiredTrash,
  TRASH_RETENTION_MS,
  trashNote,
} from "../trash";
import { createVaultService } from "../vault-service";
import { createNotifierRecorder } from "./notifier-recorder";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

function bootService() {
  const root = mkdtempSync(join(tmpdir(), "inteligir-trash-test-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const service = createVaultService({ notifier: createNotifierRecorder(), root });
  return { root, service };
}

const NOTE = "---\nid: abc\ntags: [keep]\n---\n# Body\n\nHello.\n";
const SIDECAR = `{"comments":{"c1":{"text":"hi"}}}`;

describe("trashNote / restoreNote", () => {
  it("round-trips bytes and sidecar through trash and restore", async () => {
    const { service } = bootService();
    await service.write("a/Note.md", NOTE);
    await service.write("a/Note.md.comments.json", SIDECAR);

    const trashed = await trashNote(service, "a/Note.md");
    expect(trashed.path).toBe("Trash/a/Note.md");
    expect(await service.statEntry("a/Note.md")).toBeNull();
    expect(await service.statEntry("Trash/a/Note.md.comments.json")).toBe("file");

    const inTrash = (await service.read(trashed.path)).content;
    expect(inTrash).toContain('trashed-from: "a/Note.md"');
    expect(inTrash).toContain("trashed-at:");
    // Untouched keys keep their bytes.
    expect(inTrash).toContain("id: abc");
    expect(inTrash).toContain("tags: [keep]");

    const restored = await restoreNote(service, trashed.path);
    expect(restored.path).toBe("a/Note.md");
    expect((await service.read("a/Note.md")).content).toBe(NOTE);
    expect((await service.read("a/Note.md.comments.json")).content).toBe(SIDECAR);
    expect(await service.statEntry("Trash/a/Note.md")).toBeNull();
    expect(await service.statEntry("Trash/a/Note.md.comments.json")).toBeNull();
  });

  it("suffixes on collision, in the trash and on restore alike", async () => {
    const { service } = bootService();
    await service.write("Note.md", "# one\n");
    await trashNote(service, "Note.md");
    await service.write("Note.md", "# two\n");
    const second = await trashNote(service, "Note.md");
    expect(second.path).toBe("Trash/Note 2.md");

    // Something new took the original spot; restore must not clobber it.
    await service.write("Note.md", "# occupied\n");
    const restored = await restoreNote(service, "Trash/Note 2.md");
    expect(restored.path).toBe("Note 2.md");
    expect((await service.read("Note.md")).content).toBe("# occupied\n");
    expect((await service.read("Note 2.md")).content).toBe("# two\n");
  });

  it("restores by Trash-relative path when the note has no stamp", async () => {
    const { service } = bootService();
    // Hand-moved: a file placed in Trash/ without ever being stamped.
    await service.write("Trash/b/Plain.md", "# plain\n");
    const restored = await restoreNote(service, "Trash/b/Plain.md");
    expect(restored.path).toBe("b/Plain.md");
    expect((await service.read("b/Plain.md")).content).toBe("# plain\n");
  });

  it("refuses to trash a trashed note and to restore an untrashed one", async () => {
    const { service } = bootService();
    await service.write("Trash/x.md", "# x\n");
    await expect(trashNote(service, "Trash/x.md")).rejects.toBeInstanceOf(VaultPathError);
    await service.write("y.md", "# y\n");
    await expect(restoreNote(service, "y.md")).rejects.toBeInstanceOf(VaultPathError);
  });

  it("refuses to trash a non-note", async () => {
    const { service } = bootService();
    await service.write("data.json", "{}");
    await expect(trashNote(service, "data.json")).rejects.toBeInstanceOf(VaultPathError);
  });
});

describe("listTrash / sweepExpiredTrash", () => {
  it("lists stamps and purges only what has aged past retention", async () => {
    const { service } = bootService();
    await service.write("old.md", "# old\n");
    await service.write("young.md", "# young\n");
    await service.write("undated.md", "# undated\n");
    await trashNote(service, "old.md");
    await trashNote(service, "young.md");
    await service.rename("undated.md", "Trash/undated.md");

    // Age the old note by rewriting its stamp; the sweep trusts the stamp,
    // not the filesystem.
    const oldContent = (await service.read("Trash/old.md")).content;
    const aged = oldContent.replace(
      /trashed-at: [^\n]+/,
      `trashed-at: ${new Date(Date.now() - TRASH_RETENTION_MS - 1000).toISOString()}`,
    );
    await service.write("Trash/old.md", aged);

    const before = await listTrash(service);
    expect(before.map((entry) => entry.path).toSorted()).toEqual([
      "Trash/old.md",
      "Trash/undated.md",
      "Trash/young.md",
    ]);
    expect(before.find((entry) => entry.path === "Trash/undated.md")?.trashedAt).toBeNull();

    const purged = await sweepExpiredTrash(service);
    expect(purged).toBe(1);
    expect(await service.statEntry("Trash/old.md")).toBeNull();
    expect(await service.statEntry("Trash/young.md")).toBe("file");
    // Undated entries never age.
    expect(await service.statEntry("Trash/undated.md")).toBe("file");
  });

  it("purge removes the note and its sidecar", async () => {
    const { service } = bootService();
    await service.write("n.md", "# n\n");
    await service.write("n.md.comments.json", SIDECAR);
    const trashed = await trashNote(service, "n.md");
    await purgeTrashedNote(service, trashed.path);
    expect(await service.statEntry("Trash/n.md")).toBeNull();
    expect(await service.statEntry("Trash/n.md.comments.json")).toBeNull();
  });
});
