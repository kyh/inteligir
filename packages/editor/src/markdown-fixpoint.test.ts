import type * as PlatejsMarkdown from "@platejs/markdown";
import { describe, expect, it, vi } from "vitest";

import {
  RoundTripError,
  analyzeMarkdown,
  describeGateReason,
  gateReasonFor,
  roundTrip,
  toCanonical,
} from "@repo/editor/markdown/markdown-doc";

// Every real input is a pass-1 fixpoint, so the degrade paths are exercised by
// faking serializer drift on magic tokens.
vi.mock("@platejs/markdown", async (importOriginal) => {
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
  it("degrades a never-stabilizing round-trip to Raw, badge and Format agreeing", () => {
    const analysis = analyzeMarkdown("driftforever\n");
    expect(analysis).toEqual({ kind: "unstable" });
    expect(() => roundTrip("driftforever\n")).toThrow(RoundTripError);
    expect(() => toCanonical("driftforever\n")).toThrow(RoundTripError);
    const gateReason = gateReasonFor(analysis);
    expect(gateReason).toEqual({ kind: "unstable" });
    expect(gateReason && describeGateReason(gateReason)).not.toMatch(/parse error/iu);
  });

  it("returns the settled form for a pass-2 stabilization (Format stays idempotent)", () => {
    expect(roundTrip("driftslow\n")).toBe("drift  slow\n");
    expect(toCanonical(toCanonical("driftslow\n"))).toBe("drift  slow\n");
    const analysis = analyzeMarkdown("driftslow\n");
    expect(analysis).toEqual({ kind: "normalizes" });
    expect(gateReasonFor(analysis)).toBeNull();
  });

  it("refuses rich mode when the stabilization chain loses letters", () => {
    const analysis = analyzeMarkdown("driftlossy\n");
    expect(analysis).toEqual({ kind: "roundtrip-loss" });
    const gateReason = gateReasonFor(analysis);
    expect(gateReason).toEqual({ kind: "roundtrip-loss" });
    expect(gateReason && describeGateReason(gateReason)).toBe(
      "Rich editing would change this file's content — opened in Raw to protect it",
    );
  });

  it("refuses rich mode when a save joins two lines without losing a letter", () => {
    expect(gateReasonFor(analyzeMarkdown("joined\nlines\n"))).toEqual({ kind: "roundtrip-loss" });
  });

  it("keeps rich mode when a save splits a line", () => {
    expect(analyzeMarkdown("splitme lines\n")).toEqual({ kind: "normalizes" });
  });

  it("keeps byte-identical output on the single-pass fast path", () => {
    const md = "# Hi\n\n- a\n- b\n";
    expect(analyzeMarkdown(md)).toEqual({ kind: "canonical" });
    expect(roundTrip(md)).toBe(md);
  });
});
