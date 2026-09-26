import { describe, expect, it } from "vitest";
import { commentsStorePath, parseSidecar, serializeSidecar } from "../../comments/sidecar-schema";
import type { CommentEntry, CommentSidecar } from "../../comments/sidecar-schema";
import { takenIgnoringCase } from "../../knowledge/doc-file";
import { CAPTURE_INBOX_PATH, reconcileFile } from "../reconcile-file";
import type { FileSide, ReconcileInput } from "../reconcile-file";

const HERE = "Kai’s MacBook";
const THERE = "Kai’s iPhone";

const text = (value: string): FileSide => ({ kind: "text", text: value });
const opaque = (ref: string): FileSide => ({ kind: "opaque", ref });
const absent: FileSide = { kind: "absent" };
const store = (sidecar: CommentSidecar): FileSide => text(serializeSidecar(sidecar));

const doc = (...lines: string[]): string => `${lines.join("\n")}\n`;

const reconcile = (
  sides: Pick<ReconcileInput, "path" | "base" | "mine" | "theirs"> &
    Partial<Pick<ReconcileInput, "isTaken">>,
) =>
  reconcileFile({
    isTaken: () => false,
    theirDevice: THERE,
    thisDevice: HERE,
    ...sides,
  });

describe("reconcileFile", () => {
  it("keeps mine when both sides hold the same bytes", () => {
    const same = doc("# Plan", "same");
    expect(
      reconcile({
        base: text(doc("# Plan")),
        mine: text(same),
        path: "Plan.md",
        theirs: text(same),
      }),
    ).toEqual({ copy: null, report: null, stays: { kind: "mine" } });
  });

  it("takes the side that changed when only one did", () => {
    const base = doc("# Plan", "one");
    const edited = doc("# Plan", "two");
    expect(
      reconcile({ base: text(base), mine: text(base), path: "Plan.md", theirs: text(edited) }),
    ).toEqual({ copy: null, report: null, stays: { kind: "theirs" } });
    expect(
      reconcile({ base: text(base), mine: text(edited), path: "Plan.md", theirs: text(base) }),
    ).toEqual({ copy: null, report: null, stays: { kind: "mine" } });
  });

  it("merges edits that touch different lines, with no copy", () => {
    const base = doc("# Plan", "", "alpha", "", "omega");
    const mine = doc("# Plan", "", "alpha, mine", "", "omega");
    const theirs = doc("# Plan", "", "alpha", "", "omega, theirs");
    expect(
      reconcile({ base: text(base), mine: text(mine), path: "Plan.md", theirs: text(theirs) }),
    ).toEqual({
      copy: null,
      report: null,
      stays: { kind: "merged", text: doc("# Plan", "", "alpha, mine", "", "omega, theirs") },
    });
  });

  it("keeps the merge in place over an overlap and copies theirs whole without its id", () => {
    const front = (body: string, tail: string): string =>
      doc("---", "id: 7d1c", "tags: [work, q3]", "status:  draft # keep", "---", body, "", tail);
    const base = front("Ship on Friday.", "Owner: Kai");
    const mine = front("Ship on Monday.", "Owner: Kai");
    const theirs = front("Ship on Tuesday.", "Owner: Sam");
    const result = reconcile({
      base: text(base),
      mine: text(mine),
      path: "work/Plan.md",
      theirs: text(theirs),
    });
    expect(result.stays).toEqual({
      kind: "merged",
      text: front("Ship on Monday.", "Owner: Sam"),
    });
    expect(result.copy).toEqual({
      kind: "text",
      path: "work/Plan (conflict, Kai’s iPhone).md",
      text: doc(
        "---",
        "tags: [work, q3]",
        "status:  draft # keep",
        "---",
        "Ship on Tuesday.",
        "",
        "Owner: Sam",
      ),
    });
    expect(result.report).toEqual({
      copyDevice: THERE,
      copyPath: "work/Plan (conflict, Kai’s iPhone).md",
      keptDevice: HERE,
      kind: "copied",
      path: "work/Plan.md",
    });
  });

  it("keeps mine and copies theirs when both added the path with no common version", () => {
    const result = reconcile({
      base: absent,
      mine: text(doc("# Welcome", "mine")),
      path: "Welcome.md",
      theirs: text(doc("# Welcome", "theirs")),
    });
    expect(result.stays).toEqual({ kind: "mine" });
    expect(result.copy).toEqual({
      kind: "text",
      path: "Welcome (conflict, Kai’s iPhone).md",
      text: doc("# Welcome", "theirs"),
    });
    expect(result.report?.kind).toBe("copied");
  });

  it("steps the copy past a name already taken, whatever its case", () => {
    const result = reconcile({
      base: text("a\n"),
      isTaken: takenIgnoringCase(["plan (CONFLICT, kai’s iphone).md"]),
      mine: text("mine\n"),
      path: "Plan.md",
      theirs: text("theirs\n"),
    });
    expect(result.copy?.path).toBe("Plan (conflict, Kai’s iPhone) 2.md");
  });

  it("keeps an edit over a deletion, whichever side deleted", () => {
    const base = doc("# Plan", "one");
    const edited = doc("# Plan", "two");
    expect(
      reconcile({ base: text(base), mine: absent, path: "Plan.md", theirs: text(edited) }),
    ).toEqual({
      copy: null,
      report: { deletedDevice: HERE, keptDevice: THERE, kind: "kept-edit", path: "Plan.md" },
      stays: { kind: "theirs" },
    });
    expect(
      reconcile({ base: text(base), mine: text(edited), path: "Plan.md", theirs: absent }),
    ).toEqual({
      copy: null,
      report: { deletedDevice: THERE, keptDevice: HERE, kind: "kept-edit", path: "Plan.md" },
      stays: { kind: "mine" },
    });
  });

  it("deletes a note one side deleted and the other left alone", () => {
    const base = doc("# Plan", "one");
    const deleted = { copy: null, report: null, stays: { kind: "delete" } };
    expect(
      reconcile({ base: text(base), mine: absent, path: "Plan.md", theirs: text(base) }),
    ).toEqual(deleted);
    expect(
      reconcile({ base: text(base), mine: text(base), path: "Plan.md", theirs: absent }),
    ).toEqual(deleted);
  });

  it("keeps mine and copies theirs by ref, extension kept, when both changed a file it cannot read", () => {
    const result = reconcile({
      base: opaque("b0"),
      mine: opaque("b1"),
      path: "assets/photo.png",
      theirs: opaque("b2"),
    });
    expect(result).toEqual({
      copy: { kind: "opaque", path: "assets/photo (conflict, Kai’s iPhone).png", ref: "b2" },
      report: {
        copyDevice: THERE,
        copyPath: "assets/photo (conflict, Kai’s iPhone).png",
        keptDevice: HERE,
        kind: "copied",
        path: "assets/photo.png",
      },
      stays: { kind: "mine" },
    });
  });

  it("keeps mine in another app's dot-folder, with no copy and nothing to report", () => {
    expect(
      reconcile({
        base: text('{"active":"a"}\n'),
        mine: text('{"active":"b"}\n'),
        path: ".obsidian/workspace.json",
        theirs: text('{"active":"c"}\n'),
      }),
    ).toEqual({ copy: null, report: null, stays: { kind: "mine" } });
  });

  describe("the comment store", () => {
    const path = commentsStorePath("7d1c");
    const AT = 1_707_900_000;
    const root: CommentEntry = {
      createdAt: AT,
      source: "user",
      text: "Why Friday?",
      updatedAt: AT,
    };

    it("keeps both devices' new comments and never makes a copy", () => {
      const result = reconcile({
        base: store({ c1: root }),
        mine: store({ c1: root, m1: { ...root, text: "mine" } }),
        path,
        theirs: store({ c1: root, t1: { ...root, text: "theirs" } }),
      });
      expect(result.copy).toBeNull();
      expect(result.report).toBeNull();
      expect(result.stays.kind).toBe("merged");
      const merged = result.stays.kind === "merged" ? parseSidecar(result.stays.text) : null;
      expect(merged?.ok === true ? Object.keys(merged.sidecar) : null).toEqual(["c1", "m1", "t1"]);
    });

    it("merges the beside-the-note spelling older vaults hold the same way", () => {
      const result = reconcile({
        base: store({ c1: root }),
        mine: store({ c1: root, m1: { ...root, text: "mine" } }),
        path: "work/Plan.md.comments.json",
        theirs: store({ c1: root, t1: { ...root, text: "theirs" } }),
      });
      expect(result.copy).toBeNull();
      const merged = result.stays.kind === "merged" ? parseSidecar(result.stays.text) : null;
      expect(merged?.ok === true ? merged.sidecar : null).toEqual({
        c1: root,
        m1: { ...root, text: "mine" },
        t1: { ...root, text: "theirs" },
      });
    });

    it("keeps the store whole beside a deletion, since the note it belongs to reports", () => {
      expect(
        reconcile({
          base: store({ c1: root }),
          mine: absent,
          path,
          theirs: store({ c1: root, t1: { ...root, text: "theirs" } }),
        }),
      ).toEqual({ copy: null, report: null, stays: { kind: "theirs" } });
    });

    it("keeps mine when a side is not a store it can read", () => {
      expect(
        reconcile({
          base: store({ c1: root }),
          mine: store({ c1: root, m1: root }),
          path,
          theirs: text("{ not json"),
        }),
      ).toEqual({ copy: null, report: null, stays: { kind: "mine" } });
    });
  });

  describe("the capture inbox", () => {
    it("keeps both devices' appends, mine first, with no copy", () => {
      const base = doc("# Inbox", "", "- first");
      expect(
        reconcile({
          base: text(base),
          mine: text(doc("# Inbox", "", "- first", "- captured here")),
          path: CAPTURE_INBOX_PATH,
          theirs: text(doc("# Inbox", "", "- first", "- captured there")),
        }),
      ).toEqual({
        copy: null,
        report: null,
        stays: {
          kind: "merged",
          text: doc("# Inbox", "", "- first", "- captured here", "- captured there"),
        },
      });
    });

    it("merges a nested Inbox.md like any note", () => {
      const result = reconcile({
        base: text(doc("- first")),
        mine: text(doc("- first", "- here")),
        path: `notes/${CAPTURE_INBOX_PATH}`,
        theirs: text(doc("- first", "- there")),
      });
      expect(result.copy?.path).toBe("notes/Inbox (conflict, Kai’s iPhone).md");
    });
  });
});
