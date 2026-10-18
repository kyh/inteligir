import { describe, expect, it } from "vitest";

import { entryTextOf, formulaPropsFromEntry } from "@repo/editor/formulas/formula-entry";

describe("the entry grammar", () => {
  it("makes an anonymous executable from a bare expression", () => {
    const props = formulaPropsFromEntry("2+2");
    expect(props).toEqual({ display: "4", meta: "", raw: "2+2|4", source: "2+2" });
  });

  it("strips the = prefix the editor-entry form uses", () => {
    expect(formulaPropsFromEntry("=1000*12")?.display).toBe("12,000");
  });

  it("mints an id for a named executable and keeps the name in meta", () => {
    const props = formulaPropsFromEntry("budget=5000");
    expect(props?.source).toBe("5000");
    expect(props?.display).toBe("5,000");
    expect(props?.meta).toMatch(/^id=[0-9a-f-]{36};name=budget$/u);
  });

  it("makes a symbolic variable when the value is not executable", () => {
    const props = formulaPropsFromEntry("time=9am");
    expect(props?.source).toBe("time");
    expect(props?.display).toBe("9am");
    expect(props?.meta).toMatch(/^id=[0-9a-f-]{36}$/u);
  });

  it("refuses bare non-executable text — that is prose, not a pill", () => {
    expect(formulaPropsFromEntry("hello world")).toBeNull();
  });

  it("keeps an existing id through an edit (linked instances stay linked)", () => {
    const props = formulaPropsFromEntry("budget=6000", { meta: "id=abc;name=budget" });
    expect(props?.meta).toBe("id=abc;name=budget");
    expect(props?.display).toBe("6,000");
  });

  it("round-trips a pill back to its entry text", () => {
    expect(
      entryTextOf({
        children: [{ text: "" }],
        display: "5,000",
        meta: "id=abc;name=budget",
        source: "5000",
        type: "formulaPill",
      }),
    ).toBe("budget=5000");
    expect(
      entryTextOf({
        children: [{ text: "" }],
        display: "9am",
        meta: "id=abc",
        source: "time",
        type: "formulaPill",
      }),
    ).toBe("time=9am");
    expect(
      entryTextOf({
        children: [{ text: "" }],
        display: "4",
        meta: "",
        source: "2+2",
        type: "formulaPill",
      }),
    ).toBe("2+2");
  });
});
