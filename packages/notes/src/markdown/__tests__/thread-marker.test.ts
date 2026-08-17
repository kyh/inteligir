import { describe, expect, it } from "vitest";
import {
  findThreadMarkers,
  insertThreadMarker,
  threadMarkerInsertion,
  threadMarkerRemoval,
  threadMarkerText,
} from "../thread-marker";

const DOC = `# Plans

First paragraph.

- [ ] a task line
`;

describe("threadMarkerText", () => {
  it("renders the comment form and refuses a token that could break out of it", () => {
    expect(threadMarkerText("anc_abc12")).toBe("<!-- inteligir:thread anc_abc12 -->");
    expect(() => threadMarkerText("x -->")).toThrow();
    expect(() => threadMarkerText("")).toThrow();
  });
});

describe("findThreadMarkers", () => {
  it("finds every marker with its exact offsets", () => {
    const content = `a\n${threadMarkerText("anc_one")}\nb ${threadMarkerText("anc_two")}\n`;
    const markers = findThreadMarkers(content);
    expect(markers.map((marker) => marker.anchor)).toEqual(["anc_one", "anc_two"]);
    for (const marker of markers) {
      expect(content.slice(marker.from, marker.to)).toBe(threadMarkerText(marker.anchor));
    }
  });

  it("ignores comments that are not thread markers", () => {
    expect(findThreadMarkers("<!-- plain comment -->\n<!-- inteligir:thread -->")).toEqual([]);
  });
});

describe("insertion", () => {
  it("lands on its own line below the line containing the offset", () => {
    const offset = DOC.indexOf("paragraph");
    const inserted = insertThreadMarker(DOC, offset, "anc_x");
    expect(inserted).toBe(`# Plans

First paragraph.
${threadMarkerText("anc_x")}

- [ ] a task line
`);
  });

  it("handles an offset on the last line without a trailing terminator", () => {
    const content = "only line";
    expect(insertThreadMarker(content, 4, "anc_x")).toBe(`only line\n${threadMarkerText("anc_x")}`);
  });
});

describe("removal", () => {
  it("reverses an insertion byte-exactly", () => {
    const offset = DOC.indexOf("task");
    const inserted = insertThreadMarker(DOC, offset, "anc_x");
    const marker = findThreadMarkers(inserted).find((entry) => entry.anchor === "anc_x");
    if (marker === undefined) {
      throw new Error("marker not found after insert");
    }
    const removal = threadMarkerRemoval(inserted, marker);
    expect(inserted.slice(0, removal.from) + inserted.slice(removal.to)).toBe(DOC);
  });

  it("takes only the marker bytes when the line holds other text", () => {
    const content = `before ${threadMarkerText("anc_x")} after\n`;
    const marker = findThreadMarkers(content)[0];
    if (marker === undefined) {
      throw new Error("marker not found");
    }
    const removal = threadMarkerRemoval(content, marker);
    expect(content.slice(0, removal.from) + content.slice(removal.to)).toBe("before  after\n");
  });

  it("removes a marker on the first line together with its own terminator", () => {
    const content = `${threadMarkerText("anc_x")}\nrest\n`;
    const marker = findThreadMarkers(content)[0];
    if (marker === undefined) {
      throw new Error("marker not found");
    }
    const removal = threadMarkerRemoval(content, marker);
    expect(content.slice(0, removal.from) + content.slice(removal.to)).toBe("rest\n");
  });

  it("insertion names a splice point, never a replacement", () => {
    const insertion = threadMarkerInsertion("a\nb", 0, "anc_x");
    expect(insertion.at).toBe(1);
    expect(insertion.text).toBe(`\n${threadMarkerText("anc_x")}`);
  });
});
