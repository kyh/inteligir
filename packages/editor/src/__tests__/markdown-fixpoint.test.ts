import { describe, expect, it, vi } from "vitest";

import {
  ParseFailedError,
  analyzeMarkdown,
  describeGateReason,
  gateReasonFor,
  roundTrip,
  toCanonical,
} from "@repo/editor/markdown/markdown-doc";

// Every real input is a pass-1 fixpoint, so the degrade paths are exercised by
// faking serializer drift on magic tokens.
vi.mock("@platejs/markdown", async (importOriginal) => {
  const original = await importOriginal<typeof import("@platejs/markdown")>();
  const serializeMd: typeof original.serializeMd = (editor, options) => {
    const text = JSON.stringify(options?.value ?? "");
    // never settles
    const forever = /driftforever(x*)/.exec(text);
    if (forever) return `driftforever${forever[1] ?? ""}x\n`;
    // settles on pass 2
    if (text.includes("drift  slow")) return "drift  slow\n";
    if (text.includes("drift slow")) return "drift  slow\n";
    if (text.includes("driftslow")) return "drift slow\n";
    // settles on pass 2 while losing letters
    if (text.includes("driftlossy")) return "drift lost\n";
    if (text.includes("drift lost")) return "drift lost\n";
    return original.serializeMd(editor, options);
  };
  return { ...original, serializeMd };
});

describe("bounded fixpoint check (≤3 passes)", () => {
  it("degrades a never-stabilizing round-trip to Raw, badge and Format agreeing", () => {
    const analysis = analyzeMarkdown("driftforever\n");
    expect(analysis.canonical).toBe(false);
    expect(analysis.richSafe).toBe(false);
    expect(analysis.rawReason).toEqual({
      kind: "parse-error",
      line: null,
      message: "Round-trip does not stabilize",
    });
    expect(() => roundTrip("driftforever\n")).toThrow(ParseFailedError);
    expect(() => toCanonical("driftforever\n")).toThrow(ParseFailedError);
    expect(gateReasonFor(analysis)).toEqual({
      kind: "parse-error",
      line: null,
      message: "Round-trip does not stabilize",
    });
  });

  it("returns the settled form for a pass-2 stabilization (Format stays idempotent)", () => {
    expect(roundTrip("driftslow\n")).toBe("drift  slow\n");
    expect(toCanonical(toCanonical("driftslow\n"))).toBe("drift  slow\n");
    const analysis = analyzeMarkdown("driftslow\n");
    expect(analysis.canonical).toBe(false);
    expect(analysis.richSafe).toBe(true);
    expect(analysis.rawReason).toBeNull();
    expect(gateReasonFor(analysis)).toBeNull();
  });

  it("refuses rich mode when the stabilization chain loses letters", () => {
    const analysis = analyzeMarkdown("driftlossy\n");
    expect(analysis.canonical).toBe(false);
    expect(analysis.richSafe).toBe(false);
    expect(analysis.rawReason).toBeNull();
    const gateReason = gateReasonFor(analysis);
    expect(gateReason).toEqual({ kind: "roundtrip-loss" });
    expect(gateReason && describeGateReason(gateReason)).toBe(
      "Rich editing would change this file's content — opened in Raw to protect it",
    );
  });

  it("keeps byte-identical output on the single-pass fast path", () => {
    const md = "# Hi\n\n- a\n- b\n";
    expect(analyzeMarkdown(md).canonical).toBe(true);
    expect(gateReasonFor(analyzeMarkdown(md))).toBeNull();
    expect(roundTrip(md)).toBe(md);
  });
});
