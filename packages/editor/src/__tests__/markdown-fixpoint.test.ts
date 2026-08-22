import { describe, expect, it, vi } from "vitest";

import {
  ParseFailedError,
  analyzeMarkdown,
  describeGateReason,
  gateReasonFor,
  roundTrip,
  toCanonical,
} from "@repo/editor/markdown/markdown-doc";

// Defense-in-depth probe for the gate's bounded fixpoint check: every REAL
// input is a pass-1 fixpoint today (the adversarial harness enforces it), so
// the degrade paths are exercised by faking serializer drift. serializeMd is
// wrapped to misbehave for magic tokens and pass everything else through —
// if a future pipeline change introduces a non-fixpoint form, analyzeMarkdown
// must degrade it honestly (stabilized churn or Raw) instead of letting Rich
// mode corrupt bytes save-over-save.
vi.mock("@platejs/markdown", async (importOriginal) => {
  const original = await importOriginal<typeof import("@platejs/markdown")>();
  const serializeMd: typeof original.serializeMd = (editor, options) => {
    const text = JSON.stringify(options?.value ?? "");
    // Never settles: grow by one `x` every pass.
    const forever = /driftforever(x*)/.exec(text);
    if (forever) return `driftforever${forever[1] ?? ""}x\n`;
    // Settles on pass 2: driftslow → "drift slow" → "drift  slow" (stable).
    if (text.includes("drift  slow")) return "drift  slow\n";
    if (text.includes("drift slow")) return "drift  slow\n";
    if (text.includes("driftslow")) return "drift slow\n";
    // Settles on pass 2 while LOSING letters along the chain.
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
    // The open gate sees the same verdict — message pinned so the badge copy
    // for instability stays distinguishable from real parse errors.
    expect(gateReasonFor(analysis)).toEqual({
      kind: "parse-error",
      line: null,
      message: "Round-trip does not stabilize",
    });
  });

  it("returns the settled form for a pass-2 stabilization (Format stays idempotent)", () => {
    // driftslow's chain: "drift slow" (pass 1) → "drift  slow" (fixpoint).
    expect(roundTrip("driftslow\n")).toBe("drift  slow\n");
    expect(toCanonical(toCanonical("driftslow\n"))).toBe("drift  slow\n");
    // Whitespace-only drift keeps every letter — rich stays safe, not canonical.
    const analysis = analyzeMarkdown("driftslow\n");
    expect(analysis.canonical).toBe(false);
    expect(analysis.richSafe).toBe(true);
    expect(analysis.rawReason).toBeNull();
    // Normalizing tier still opens Rich at the gate.
    expect(gateReasonFor(analysis)).toBeNull();
  });

  it("refuses rich mode when the stabilization chain loses letters", () => {
    // Pass 1 already drops "y": rich saves would corrupt progressively.
    const analysis = analyzeMarkdown("driftlossy\n");
    expect(analysis.canonical).toBe(false);
    expect(analysis.richSafe).toBe(false);
    expect(analysis.rawReason).toBeNull(); // honest churn, Format still offered
    // The end-to-end proof: a content-losing serializer now gates to Raw with
    // its own reason (DocAnalysis semantics deliberately unchanged above).
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
