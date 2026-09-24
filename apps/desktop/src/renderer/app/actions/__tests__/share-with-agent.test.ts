import { markerRootIds } from "@repo/notes/comments/marker-ids";
import { describe, expect, it } from "vitest";

import { shareWithAgentText } from "../share-with-agent";

describe("the brief handed to an external agent", () => {
  it("spells every comment anchor as a marker the dialect parses", () => {
    const spelled = shareWithAgentText("Plans.md").match(/%%i:[^%]*%%/gu) ?? [];
    expect(spelled.length).toBeGreaterThan(0);
    for (const marker of spelled) {
      expect(markerRootIds(`before ${marker} after`), marker).toEqual(new Set(["id"]));
    }
  });
});
