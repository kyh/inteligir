import { describe, expect, it } from "vitest";
import { takenIgnoringCase } from "../../knowledge/doc-file";
import { parseVaultPath } from "../../knowledge/vault-path";
import {
  conflictCopyPath,
  describeSyncConflict,
  deviceLabel,
  parseConflictCopyPath,
} from "../conflict-copy";

const nothingTaken = (): boolean => false;

describe("conflictCopyPath", () => {
  it("names the device beside the note's own name", () => {
    expect(conflictCopyPath("Plan.md", "Kai’s iPhone", nothingTaken)).toBe(
      "Plan (conflict, Kai’s iPhone).md",
    );
  });

  it("stays in the note's folder", () => {
    expect(conflictCopyPath("work/q3/Plan.md", "MacBook", nothingTaken)).toBe(
      "work/q3/Plan (conflict, MacBook).md",
    );
  });

  it("keeps the extension, so the copy opens as what it is", () => {
    expect(conflictCopyPath("todo.txt", "MacBook", nothingTaken)).toBe(
      "todo (conflict, MacBook).txt",
    );
    expect(conflictCopyPath("assets/photo.png", "MacBook", nothingTaken)).toBe(
      "assets/photo (conflict, MacBook).png",
    );
    expect(conflictCopyPath("Makefile", "MacBook", nothingTaken)).toBe(
      "Makefile (conflict, MacBook)",
    );
  });

  it("steps past a taken name, whatever its case", () => {
    const taken = takenIgnoringCase([
      "PLAN (conflict, macbook).md",
      "plan (Conflict, MacBook) 2.MD",
    ]);
    expect(conflictCopyPath("Plan.md", "MacBook", taken)).toBe("Plan (conflict, MacBook) 3.md");
  });

  describe("over any device name", () => {
    const corpus = ["a/b:c", "[[x]]|#y", "", "x".repeat(200), "inteligir", "Kai’s iPhone"];

    it.each(corpus)("writes a vault path that parses back to the note and the label: %j", (raw) => {
      const copy = conflictCopyPath("notes/Plan.md", raw, nothingTaken);
      const parsed = parseVaultPath(copy);
      expect(parsed).toEqual({ ok: true, path: copy });
      expect(parseConflictCopyPath(copy)).toEqual({
        device: deviceLabel(raw),
        path: "notes/Plan.md",
      });
    });

    it("round-trips a stepped copy and a file with no extension", () => {
      const stepped = conflictCopyPath(
        "Plan.md",
        "a/b",
        takenIgnoringCase(["Plan (conflict, ab).md"]),
      );
      expect(stepped).toBe("Plan (conflict, ab) 2.md");
      expect(parseConflictCopyPath(stepped)).toEqual({ device: "ab", path: "Plan.md" });
      expect(parseConflictCopyPath("Makefile (conflict, MacBook)")).toEqual({
        device: "MacBook",
        path: "Makefile",
      });
    });
  });
});

describe("deviceLabel", () => {
  it("drops what a path or a link would refuse and collapses the rest", () => {
    expect(deviceLabel("a/b:c")).toBe("abc");
    expect(deviceLabel("[[x]]|#y")).toBe("xy");
    expect(deviceLabel("  Kai’s\t\niPhone\u0000 ")).toBe("Kai’s iPhone");
  });

  it("caps the label at forty characters", () => {
    expect(deviceLabel("x".repeat(200))).toBe("x".repeat(40));
  });

  it("names an unknown device plainly, including the committer older commits carry", () => {
    expect(deviceLabel("")).toBe("another device");
    expect(deviceLabel("?*|")).toBe("another device");
    expect(deviceLabel("inteligir")).toBe("another device");
  });
});

describe("parseConflictCopyPath", () => {
  it.each([
    "Plan.md",
    "Plan (conflict, a:b).md",
    "Plan (conflict, inteligir).md",
    "Plan (conflict, ).md",
    "Plan (conflict, MacBook) 1.md",
    "Plan (conflict, MacBook) 02.md",
    "Plan (conflict, MacBook.md",
    " (conflict, MacBook).md",
    "Plan (conflicted, MacBook).md",
    "v1.2 (conflict, MacBook)",
  ])("reads %j as no copy", (name) => {
    expect(parseConflictCopyPath(name)).toBeNull();
  });

  it("reads the innermost copy of a copy", () => {
    expect(parseConflictCopyPath("Plan (conflict, A) (conflict, B).md")).toEqual({
      device: "B",
      path: "Plan (conflict, A).md",
    });
  });
});

describe("describeSyncConflict", () => {
  const copied = {
    copyDevice: "Kai’s iPhone",
    copyPath: "work/Plan (conflict, Kai’s iPhone).md",
    keptDevice: "Kai’s MacBook",
    kind: "copied",
    path: "work/Plan.md",
  } as const;

  it("tells the device that kept its version where the other went", () => {
    expect(describeSyncConflict(copied, { thisDevice: "Kai’s MacBook" })).toBe(
      "Both versions of “Plan” were kept: yours stays, and the one from Kai’s iPhone is in “Plan (conflict, Kai’s iPhone)”.",
    );
  });

  it("tells the device whose version was copied where its version went", () => {
    expect(describeSyncConflict(copied, { thisDevice: "Kai’s iPhone" })).toBe(
      "Both versions of “Plan” were kept: the one from Kai’s MacBook stays, and yours is in “Plan (conflict, Kai’s iPhone)”.",
    );
  });

  it("names both devices to a third", () => {
    expect(describeSyncConflict(copied, { thisDevice: "Work Mac" })).toBe(
      "Both versions of “Plan” were kept: the one from Kai’s MacBook stays, and the one from Kai’s iPhone is in “Plan (conflict, Kai’s iPhone)”.",
    );
  });

  it("names a copy that is not a note by its whole file name", () => {
    expect(
      describeSyncConflict(
        {
          ...copied,
          copyPath: "assets/photo (conflict, Kai’s iPhone).png",
          path: "assets/photo.png",
        },
        { thisDevice: "Kai’s MacBook" },
      ),
    ).toBe(
      "Both versions of “photo.png” were kept: yours stays, and the one from Kai’s iPhone is in “photo (conflict, Kai’s iPhone).png”.",
    );
  });

  describe("an edit kept over a deletion", () => {
    const keptEdit = {
      deletedDevice: "Kai’s iPhone",
      keptDevice: "Kai’s MacBook",
      kind: "kept-edit",
      path: "Plan.md",
    } as const;

    it("from the device that edited", () => {
      expect(describeSyncConflict(keptEdit, { thisDevice: "Kai’s MacBook" })).toBe(
        "“Plan” was deleted on Kai’s iPhone but edited here, so it was kept.",
      );
    });

    it("from the device that deleted", () => {
      expect(describeSyncConflict(keptEdit, { thisDevice: "Kai’s iPhone" })).toBe(
        "“Plan” was deleted here but edited on Kai’s MacBook, so it was kept.",
      );
    });

    it("from a third device", () => {
      expect(describeSyncConflict(keptEdit, { thisDevice: "Work Mac" })).toBe(
        "“Plan” was deleted on Kai’s iPhone but edited on Kai’s MacBook, so it was kept.",
      );
    });
  });
});
