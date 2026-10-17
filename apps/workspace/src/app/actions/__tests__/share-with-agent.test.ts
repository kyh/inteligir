import { markerRootIds } from "@repo/notes/annotations/marker-ids";
import { ANNOTATION_MARKER_STRIP_RE } from "@repo/notes/markdown/remark-inline-constructs";
import { describe, expect, it } from "vitest";

import { shareWithAgentText } from "../share-with-agent";

describe("the brief handed to an external agent", () => {
  it("spells every annotation anchor as a marker the dialect parses", () => {
    const spelled = shareWithAgentText("Plans.md").match(ANNOTATION_MARKER_STRIP_RE) ?? [];
    expect(spelled.length).toBeGreaterThan(0);
    for (const marker of spelled) {
      expect(markerRootIds(`before ${marker} after`), marker).toEqual(new Set(["id"]));
    }
  });
});
