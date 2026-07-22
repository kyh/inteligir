// ---------------------------------------------------------------------------
// relatedNotes scorer — driven through the KnowledgeIndex reference
// composition (real projections, real link resolution, real tag index, the
// in-memory lexical engine), which is exactly how the host/harness compose it
// (LinkGraphIndex + their own search port).
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import { KnowledgeIndex } from "../knowledge/knowledge-index";
import type { RelatedNoteEntry } from "../knowledge/related-notes";

/** The structural cluster: `subject` links to `hub` and carries two tags. */
const CORPUS: Record<string, string> = {
  "notes/subject.md": "# Subject\n\nSee [[hub]].\n\n#alpha #beta\n",
  // Direct forward neighbor — must NOT appear (the Links panel owns it).
  "notes/hub.md": "# Hub\n\nPlain body.\n",
  // Shares the forward target `hub` (bibliographic coupling).
  "notes/coupled.md": "# Coupled\n\nAlso about [[hub]].\n",
  // Direct backlink neighbor — links to subject, must NOT appear.
  "notes/citer.md": "# Citer\n\nBoth [[subject]] and [[cocited]].\n",
  // Co-cited: `citer` links to subject AND to this.
  "notes/cocited.md": "# Cocited\n\nPlain body.\n",
  "notes/tagmates.md": "# Tagmates\n\n#alpha #beta\n",
  "notes/tagmate-single.md": "# Single\n\n#alpha\n",
  "notes/unrelated.md": "# Unrelated\n\nNothing in common here.\n",
};

function seed(extra: Record<string, string> = {}): KnowledgeIndex {
  const index = new KnowledgeIndex();
  for (const [path, content] of Object.entries({ ...CORPUS, ...extra })) {
    index.setDoc(path, content);
  }
  return index;
}

function entryFor(entries: RelatedNoteEntry[], path: string): RelatedNoteEntry {
  const entry = entries.find((candidate) => candidate.path === path);
  expect(entry, `expected ${path} among ${entries.map((e) => e.path).join(", ")}`).toBeDefined();
  if (!entry) throw new Error("unreachable");
  return entry;
}

describe("relatedNotes (KnowledgeIndex composition)", () => {
  it("surfaces shared-target, co-cited and shared-tag notes — never the unrelated one", () => {
    const related = seed().relatedNotes("notes/subject.md");
    const paths = related.map((entry) => entry.path);
    expect(paths).toContain("notes/coupled.md");
    expect(paths).toContain("notes/cocited.md");
    expect(paths).toContain("notes/tagmates.md");
    expect(paths).not.toContain("notes/unrelated.md");
  });

  it("excludes the note itself and its direct neighbors (Links/Backlinks own those)", () => {
    const paths = seed()
      .relatedNotes("notes/subject.md")
      .map((entry) => entry.path);
    expect(paths).not.toContain("notes/subject.md");
    expect(paths).not.toContain("notes/hub.md"); // forward target
    expect(paths).not.toContain("notes/citer.md"); // backlink source
  });

  it("explains a shared link target and ranks it above a single shared tag", () => {
    const related = seed().relatedNotes("notes/subject.md");
    const coupled = entryFor(related, "notes/coupled.md");
    expect(coupled.reasons).toContain("both link to Hub");
    const single = entryFor(related, "notes/tagmate-single.md");
    expect(coupled.score).toBeGreaterThan(single.score);
  });

  it("explains co-citation (a third note links to both)", () => {
    const related = seed().relatedNotes("notes/subject.md");
    expect(entryFor(related, "notes/cocited.md").reasons).toContain("linked together in Citer");
  });

  it("counts shared tags: two shared tags outrank one, with the tags named", () => {
    const related = seed().relatedNotes("notes/subject.md");
    const two = entryFor(related, "notes/tagmates.md");
    const one = entryFor(related, "notes/tagmate-single.md");
    expect(two.score).toBeGreaterThan(one.score);
    expect(two.reasons).toContain("shares #alpha and #beta");
    expect(one.reasons).toContain("shares #alpha");
  });

  it("finds lexically similar notes with no links or tags at all", () => {
    const index = new KnowledgeIndex();
    index.setDoc("notes/rocket engines.md", "# Rocket Engines\n\nCombustion chambers.\n");
    index.setDoc("notes/history.md", "# History\n\nEarly rocket engines were unstable.\n");
    index.setDoc("notes/gardening.md", "# Gardening\n\nTomatoes and soil.\n");
    const related = index.relatedNotes("notes/rocket engines.md");
    expect(entryFor(related, "notes/history.md").reasons).toContain("similar text");
    expect(related.map((entry) => entry.path)).not.toContain("notes/gardening.md");
  });

  it("returns empty for a note with no connections, and for an unknown path", () => {
    expect(seed().relatedNotes("notes/unrelated.md")).toEqual([]);
    expect(seed().relatedNotes("nowhere/ghost.md")).toEqual([]);
    expect(new KnowledgeIndex().relatedNotes("notes/subject.md")).toEqual([]);
  });

  it("respects the limit, best-first", () => {
    const related = seed().relatedNotes("notes/subject.md", { limit: 1 });
    expect(related).toHaveLength(1);
    const all = seed().relatedNotes("notes/subject.md");
    expect(related[0]?.path).toBe(all[0]?.path);
  });

  describe("privacy — backlinks() parity", () => {
    const PRIVATE_MATE = "notes/private-mate.md";
    const withPrivate = (): KnowledgeIndex =>
      seed({ [PRIVATE_MATE]: "---\nprivate: true\n---\n\n# Private mate\n\n#alpha\n" });

    it("shows private candidates by default (the user's own screen)", () => {
      const paths = withPrivate()
        .relatedNotes("notes/subject.md")
        .map((entry) => entry.path);
      expect(paths).toContain(PRIVATE_MATE);
    });

    it("drops private candidates entirely under excludePrivate", () => {
      const entries = withPrivate().relatedNotes("notes/subject.md", { excludePrivate: true });
      expect(JSON.stringify(entries)).not.toContain("private-mate");
    });

    it("returns silent [] for a private subject under excludePrivate", () => {
      const index = seed({
        "notes/secret.md": "---\nprivate: true\n---\n\n# Secret\n\nSee [[hub]].\n\n#alpha\n",
      });
      expect(index.relatedNotes("notes/secret.md", { excludePrivate: true })).toEqual([]);
      // …but the same call WITHOUT the flag ranks normally (renderer surface).
      expect(index.relatedNotes("notes/secret.md").length).toBeGreaterThan(0);
    });

    it("treats unparseable frontmatter as private (fail-closed)", () => {
      const index = seed({
        "notes/broken.md": "---\n: [unparseable\n---\n\n# Broken\n\n#alpha\n",
      });
      const entries = index.relatedNotes("notes/subject.md", { excludePrivate: true });
      expect(JSON.stringify(entries)).not.toContain("broken");
      expect(index.relatedNotes("notes/broken.md", { excludePrivate: true })).toEqual([]);
    });
  });
});
