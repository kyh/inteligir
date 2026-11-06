import { describe, expect, it } from "vitest";

import { markerRootIds, stripAnnotationMarkers } from "./annotation-markers";

describe(markerRootIds, () => {
  it("collects comma-shared ids and ignores fences", () => {
    const source = [
      "A %%i:c1:start%%range%%i:c1:end%% and %%i:a,b:start%%shared%%i:a,b:end%%.",
      "",
      "```",
      "%%i:fenced:start%% literal %%i:fenced:end%%",
      "```",
      "",
    ].join("\n");
    expect(markerRootIds(source)).toStrictEqual(new Set(["c1", "a", "b"]));
  });

  it("reads the markers of a doc holding a tag that cannot pair", () => {
    expect(markerRootIds("%%i:c1:start%%x%%i:c1:end%% <Foo>broken</Bar>\n")).toStrictEqual(
      new Set(["c1"]),
    );
  });
});

describe("stripping markers", () => {
  it("splices out exactly the named ids, keeping the rest of a shared pair", () => {
    const content = "x %%i:a1,b2:start%%y%%i:a1,b2:end%% %%i:c3:start%%z%%i:c3:end%%\n";
    expect(stripAnnotationMarkers(content, ["a1"])).toBe(
      "x %%i:b2:start%%y%%i:b2:end%% %%i:c3:start%%z%%i:c3:end%%\n",
    );
    expect(stripAnnotationMarkers(content, ["a1", "b2", "c3"])).toBe("x y z\n");
  });

  it("leaves a marker in code and an escaped one alone", () => {
    const content = "`%%i:a1:start%%` \\%%i:a1:end%% %%i:a1:start%%k%%i:a1:end%%\n";
    expect(stripAnnotationMarkers(content, ["a1"])).toBe("`%%i:a1:start%%` \\%%i:a1:end%% k\n");
  });
});
