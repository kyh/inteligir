import type * as PlatejsMarkdown from "@platejs/markdown";
import { describe, expect, it, vi } from "vitest";

import {
  RoundTripError,
  analyzeMarkdown,
  roundTrip,
  toCanonical,
} from "@repo/editor/markdown/markdown-doc";

// Every real input is a pass-1 fixpoint, so the degrade paths are exercised by
// faking serializer drift on magic tokens.
vi.mock(import("@platejs/markdown"), async (importOriginal) => {
  const original = await importOriginal<typeof PlatejsMarkdown>();
  const serializeMd: typeof original.serializeMd = (editor, options) => {
    const text = JSON.stringify(options?.value ?? "");
    // never settles
    const forever = /driftforever(?<xs>x*)/u.exec(text);
    if (forever) {
      return `driftforever${forever.groups?.xs ?? ""}x\n`;
    }
    // settles on pass 2
    if (text.includes("drift  slow")) {
      return "drift  slow\n";
    }
    if (text.includes("drift slow")) {
      return "drift  slow\n";
    }
    if (text.includes("driftslow")) {
      return "drift slow\n";
    }
    // settles on pass 2 while losing letters
    if (text.includes("driftlossy")) {
      return "drift lost\n";
    }
    if (text.includes("drift lost")) {
      return "drift lost\n";
    }
    // keeps every letter while joining two lines, or splitting one
    if (text.includes("joined")) {
      return "joinedlines\n";
    }
    if (text.includes("splitme")) {
      return "splitme\n\nlines\n";
    }
    return original.serializeMd(editor, options);
  };
  return { ...original, serializeMd };
});

describe("bounded fixpoint check (≤3 passes)", () => {
  it("names a never-stabilizing round-trip unstable, the analysis and Format agreeing", () => {
    expect(analyzeMarkdown("driftforever\n")).toStrictEqual({ kind: "unstable" });
    expect(() => roundTrip("driftforever\n")).toThrow(RoundTripError);
    expect(() => toCanonical("driftforever\n")).toThrow(RoundTripError);
  });

  it("returns the settled form for a pass-2 stabilization (Format stays idempotent)", () => {
    expect(roundTrip("driftslow\n")).toBe("drift  slow\n");
    expect(toCanonical(toCanonical("driftslow\n"))).toBe("drift  slow\n");
    expect(analyzeMarkdown("driftslow\n")).toStrictEqual({ kind: "normalizes" });
  });

  it("names a loss when the stabilization chain loses letters", () => {
    expect(analyzeMarkdown("driftlossy\n")).toStrictEqual({ kind: "roundtrip-loss" });
  });

  it("names a loss when a save joins two lines without losing a letter", () => {
    expect(analyzeMarkdown("joined\nlines\n")).toStrictEqual({ kind: "roundtrip-loss" });
  });

  it("calls a save that splits a line a normalization", () => {
    expect(analyzeMarkdown("splitme lines\n")).toStrictEqual({ kind: "normalizes" });
  });

  it("keeps byte-identical output on the single-pass fast path", () => {
    const md = "# Hi\n\n- a\n- b\n";
    expect(analyzeMarkdown(md)).toStrictEqual({ kind: "canonical" });
    expect(roundTrip(md)).toBe(md);
  });
});
