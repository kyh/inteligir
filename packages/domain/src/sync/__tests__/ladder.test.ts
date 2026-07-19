import { describe, expect, it } from "vitest";

import { appendUnion } from "../merge/append-union";
import { mergeFrontmatterOnly } from "../merge/frontmatter-merge";
import { mergeLadder, type MergeBase, type MergeResult } from "../merge/ladder";

const enc = new TextEncoder();
const dec = new TextDecoder();

function bytesBase(text: string): MergeBase {
  return { kind: "bytes", bytes: enc.encode(text) };
}

function run(base: MergeBase, local: string, remote: string): MergeResult {
  return mergeLadder({ base, local: enc.encode(local), remote: enc.encode(remote) });
}

function mergedText(result: MergeResult): string {
  if (result.kind !== "merged") throw new Error("expected a merge");
  return dec.decode(result.bytes);
}

describe("mergeLadder", () => {
  describe("rung 1 — whitespace-equal", () => {
    it("converges trailing-whitespace-only divergence to the REMOTE bytes", () => {
      const result = run(bytesBase("a\nb\n"), "a  \nb\n\n\n", "a\nb\n");
      expect(result).toEqual({ kind: "merged", bytes: enc.encode("a\nb\n"), rung: "whitespace" });
    });

    it("treats a trailing-newline-only difference as whitespace", () => {
      const result = run({ kind: "absent" }, "a\nb", "a\nb\n");
      expect(result.kind === "merged" && result.rung).toBe("whitespace");
      expect(mergedText(result)).toBe("a\nb\n");
    });

    it("needs no base — works even when the base is unavailable", () => {
      const result = run({ kind: "unavailable" }, "line \n", "line\n");
      expect(result.kind === "merged" && result.rung).toBe("whitespace");
    });
  });

  describe("rung 2 — diff3 over the true base", () => {
    it("merges disjoint edits cleanly", () => {
      const base = "one\ntwo\nthree\nfour\nfive\n";
      const local = "ONE\ntwo\nthree\nfour\nfive\n"; // edited line 1
      const remote = "one\ntwo\nthree\nfour\nFIVE\n"; // edited line 5
      const result = run(bytesBase(base), local, remote);
      expect(result.kind === "merged" && result.rung).toBe("diff3");
      expect(mergedText(result)).toBe("ONE\ntwo\nthree\nfour\nFIVE\n");
    });

    it("refuses overlapping edits (same line changed differently) → conflict", () => {
      const base = "one\ntwo\nthree\n";
      const result = run(bytesBase(base), "one\nLOCAL\nthree\n", "one\nREMOTE\nthree\n");
      expect(result).toEqual({ kind: "conflict" });
    });

    it("never runs without true base bytes (unavailable base + mid-file edits → conflict)", () => {
      const result = run({ kind: "unavailable" }, "one\nLOCAL\nthree\n", "one\ntwo\nthree\nmore\n");
      expect(result).toEqual({ kind: "conflict" });
    });
  });

  describe("rung 4 — append-union (reached THROUGH diff3's conflict)", () => {
    it("both appended to the same journal → union, remote tail first", () => {
      const base = "# 2026-07-15\n\n- morning note\n";
      const local = "# 2026-07-15\n\n- morning note\n- local afternoon\n";
      const remote = "# 2026-07-15\n\n- morning note\n- remote lunch\n";
      // diff3 reports both-appended-at-EOF as a same-position conflict; the
      // ladder must FALL THROUGH it, not stop.
      const result = run(bytesBase(base), local, remote);
      expect(result.kind === "merged" && result.rung).toBe("append-union");
      expect(mergedText(result)).toBe(
        "# 2026-07-15\n\n- morning note\n- remote lunch\n- local afternoon\n",
      );
    });

    it("creation collision (no base entry) → union of both new files", () => {
      const result = run({ kind: "absent" }, "# Today\n\n- from B\n", "# Today\n\n- from A\n");
      expect(result.kind === "merged" && result.rung).toBe("append-union");
      expect(mergedText(result)).toBe("# Today\n\n- from A\n- from B\n");
    });

    it("a mid-note edit refuses union (tails share the note's own lines)", () => {
      const base = "intro\nshared tail\n";
      const local = "intro\ninserted locally\nshared tail\n";
      const remote = "intro\ninserted remotely\nshared tail\n";
      expect(run(bytesBase(base), local, remote)).toEqual({ kind: "conflict" });
    });

    it("never unions on an unavailable base (indistinguishable from a mid-file edit)", () => {
      const result = run({ kind: "unavailable" }, "base\nlocal\n", "base\nremote\n");
      expect(result).toEqual({ kind: "conflict" });
    });

    it("refuses when the base is NOT a line-prefix of both sides", () => {
      // local rewrote the base line, then appended — not provably append-shaped.
      const result = run(bytesBase("base\n"), "rewritten\nlocal\n", "base\nremote\n");
      expect(result).toEqual({ kind: "conflict" });
    });

    it("is idempotent: a side whose tail is already incorporated converges to remote", () => {
      // B pushed base+B earlier (its base advanced); A merged and pushed
      // base+B+A. B now merges its (unchanged) state against the merged file.
      const merged = "day\n- from B\n- from A\n";
      const result = run(bytesBase("day\n- from B\n"), "day\n- from B\n", merged);
      // Local added nothing → remote verbatim → hash-equal upstream, no push.
      expect(mergedText(result)).toBe(merged);
    });
  });

  describe("input hygiene", () => {
    it("invalid UTF-8 on either side → conflict (never mangled)", () => {
      const bad = new Uint8Array([0x68, 0x69, 0xff, 0xfe, 0x0a]);
      expect(
        mergeLadder({ base: { kind: "absent" }, local: bad, remote: enc.encode("hi\n") }),
      ).toEqual({ kind: "conflict" });
      expect(
        mergeLadder({ base: { kind: "absent" }, local: enc.encode("hi\n"), remote: bad }),
      ).toEqual({ kind: "conflict" });
    });

    it("a literal U+FFFD in valid UTF-8 is NOT mistaken for invalid input", () => {
      const result = run({ kind: "absent" }, "a\n� local\n", "a\n� local\n- more\n");
      expect(result.kind).toBe("merged");
    });
  });
});

describe("appendUnion", () => {
  it("emits prefix + remote tail + local tail with the trailing newline restored", () => {
    expect(appendUnion("p\nR\n", "p\nL\n")).toBe("p\nR\nL\n");
  });

  it("trims trailing blank lines from tails before joining", () => {
    expect(appendUnion("p\nR\n\n\n", "p\nL\n\n")).toBe("p\nR\nL\n");
  });

  it("whole-tail dedupe: equal tails → remote verbatim", () => {
    expect(appendUnion("p\nsame\n", "p\nsame\n\n")).toBe("p\nsame\n");
  });

  it("one side empty → the other side verbatim", () => {
    expect(appendUnion("p\n", "p\nL\n")).toBe("p\nL\n");
    expect(appendUnion("p\nR\n", "p\n")).toBe("p\nR\n");
  });

  it("NEVER per-line dedupes: repeated identical items in ONE tail survive", () => {
    expect(appendUnion("p\nR\n", "p\n- [ ] follow up\n- [ ] follow up\n")).toBe(
      "p\nR\n- [ ] follow up\n- [ ] follow up\n",
    );
  });

  it("refuses tails sharing a non-blank line", () => {
    expect(appendUnion("p\nshared\nR\n", "p\nL\nshared\n")).toBeNull();
  });

  it("shared BLANK lines across tails do not refuse the union", () => {
    expect(appendUnion("p\nR\n\nR2\n", "p\nL\n\nL2\n")).toBe("p\nR\n\nR2\nL\n\nL2\n");
  });

  it("preserves a missing trailing newline when neither side had one", () => {
    expect(appendUnion("p\nR", "p\nL")).toBe("p\nR\nL");
  });
});

describe("mergeFrontmatterOnly (rung 3)", () => {
  const body = "# Note\n\ncontent\n";

  it("merges one-sided key changes from both sides (add + edit + delete)", () => {
    const base = `---\ntitle: t\nstatus: draft\nowner: kyh\n---\n${body}`;
    const local = `---\ntitle: t2\nstatus: draft\nowner: kyh\n---\n${body}`; // edited title
    const remote = `---\ntitle: t\nstatus: final\nowner: kyh\ndue: 2026-07-20\n---\n${body}`; // edited status, added due
    expect(mergeFrontmatterOnly(base, local, remote)).toBe(
      `---\ntitle: t2\nstatus: final\nowner: kyh\ndue: 2026-07-20\n---\n${body}`,
    );
  });

  it("applies a remote key DELETION without resurrecting it", () => {
    const base = `---\na: 1\nb: 2\n---\n${body}`;
    const local = `---\na: 1\nb: 2\ncc: 3\n---\n${body}`; // local added c
    const remote = `---\na: 1\n---\n${body}`; // remote deleted b
    expect(mergeFrontmatterOnly(base, local, remote)).toBe(`---\na: 1\ncc: 3\n---\n${body}`);
  });

  it("both changed the same key differently → refuse", () => {
    const base = `---\ntitle: t\n---\n${body}`;
    expect(
      mergeFrontmatterOnly(base, `---\ntitle: A\n---\n${body}`, `---\ntitle: B\n---\n${body}`),
    ).toBeNull();
  });

  it("both changed the same key identically → merge", () => {
    const base = `---\ntitle: t\nlocal: 0\n---\n${body}`;
    const local = `---\ntitle: same\nlocal: 1\n---\n${body}`;
    const remote = `---\ntitle: same\nlocal: 0\n---\n${body}`;
    expect(mergeFrontmatterOnly(base, local, remote)).toBe(
      `---\ntitle: same\nlocal: 1\n---\n${body}`,
    );
  });

  it("bodies differ → refuse (this rung is header-only)", () => {
    const base = `---\na: 1\n---\nbody one\n`;
    expect(
      mergeFrontmatterOnly(base, `---\na: 2\n---\nbody one\n`, `---\na: 1\n---\nbody TWO\n`),
    ).toBeNull();
  });

  it("preserves untouched keys' bytes — comments included — under surgery", () => {
    const base = `---\nkeep: 1 # important comment\ntitle: t\n---\n${body}`;
    const local = `---\nkeep: 1 # important comment\ntitle: t\n---\n${body}`; // unchanged
    const remote = `---\nkeep: 1 # important comment\ntitle: t2\n---\n${body}`;
    expect(mergeFrontmatterOnly(base, local, remote)).toBe(
      `---\nkeep: 1 # important comment\ntitle: t2\n---\n${body}`,
    );
  });

  it("refuses when a header it would rewrite cannot round-trip byte-exactly (flow style)", () => {
    // yaml's printer normalizes `{x: 1}` to `{ x: 1 }` — the rung must refuse
    // rather than silently reformat an untouched key.
    const base = `---\nweird: {x: 1}\ntitle: t\n---\n${body}`;
    const local = `---\nweird: {x: 1}\ntitle: t\n---\n${body}`;
    const remote = `---\nweird: {x: 1}\ntitle: t2\n---\n${body}`;
    expect(mergeFrontmatterOnly(base, local, remote)).toBeNull();
  });

  it("refuses a remote-won UNSUPPORTED value (never transplants what it can't type)", () => {
    const base = `---\nnested:\n  a: 1\n---\n${body}`;
    const local = `---\nnested:\n  a: 1\n---\n${body}`;
    const remote = `---\nnested:\n  a: 2\n---\n${body}`;
    expect(mergeFrontmatterOnly(base, local, remote)).toBeNull();
  });

  it("refuses invalid yaml anywhere (what it can't read, it can't destroy)", () => {
    const base = `---\na: 1\n---\n${body}`;
    const broken = `---\na: [unclosed\n---\n${body}`;
    expect(mergeFrontmatterOnly(base, broken, `---\na: 2\n---\n${body}`)).toBeNull();
  });

  it("remote added frontmatter to a file that had none locally", () => {
    const base = body;
    const local = body;
    const remote = `---\ntitle: added\n---\n${body}`;
    // localChanged=false, remoteChanged=true for `title` — but local === base
    // means this is one-sided and reconcile never forks it; still, the rung
    // must handle a header-less local without throwing.
    expect(mergeFrontmatterOnly(base, local, remote)).toBe(remote);
  });

  it("no base (creation collision): disjoint keys union, clashing keys refuse", () => {
    const local = `---\na: 1\n---\n${body}`;
    const remote = `---\nb: 2\n---\n${body}`;
    expect(mergeFrontmatterOnly(null, local, remote)).toBe(`---\na: 1\nb: 2\n---\n${body}`);
    expect(mergeFrontmatterOnly(null, local, `---\na: 9\n---\n${body}`)).toBeNull();
  });

  it("reaches a merge through the LADDER when both sides added a key at the same position (diff3 conflict)", () => {
    const base = `---\ntitle: t\n---\n${body}`;
    const local = `---\ntitle: t\naa: 1\n---\n${body}`;
    const remote = `---\ntitle: t\nbb: 2\n---\n${body}`;
    const result = run(bytesBase(base), local, remote);
    expect(result.kind === "merged" && result.rung).toBe("frontmatter");
    expect(mergedText(result)).toBe(`---\ntitle: t\naa: 1\nbb: 2\n---\n${body}`);
  });

  it("is refused by the ladder on an UNAVAILABLE base (would resurrect deleted keys)", () => {
    // base had `gone: 1`; remote deleted it; local unchanged. With no base
    // bytes an empty-base view would see `gone` as a local-only add and
    // resurrect it — the ladder must refuse instead (one copy, then healed).
    const local = `---\ngone: 1\ntitle: t\n---\n${body}`;
    const remote = `---\ntitle: t2\n---\n${body}`;
    expect(run({ kind: "unavailable" }, local, remote)).toEqual({ kind: "conflict" });
  });
});
