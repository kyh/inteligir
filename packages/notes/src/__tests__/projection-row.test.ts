import { describe, expect, it } from "vitest";

import { projectDoc } from "../knowledge/projection";
import { parseStoredProjection } from "../knowledge/projection-row";

const KITCHEN_SINK = [
  "---",
  "id: 0b6f1c2e-5d4a-4f7b-8e9c-1a2b3c4d5e6f",
  "aliases: [Sink, The Sink]",
  "tags: [kitchen, '#home/rooms']",
  "pinned: true",
  "---",
  "",
  "# Kitchen sink",
  "",
  "## Links",
  "",
  "[[Plain]], [[Aliased|shown]], [[Anchored#Part]], ![[Embedded]] and ![[photo.png]].",
  "",
  "[md](notes/other.md#frag), ![alt](img/shot%201.png) and [ref][r].",
  "",
  "[r]: refs/target.md",
  "",
  "```inteligir-callout",
  "note",
  "Inside a callout: [[Called Out]] #inside",
  "```",
  "",
  "Prose #tag and #nested/deep.",
  "",
].join("\n");

describe("the stored projection", () => {
  it("round-trips through the store's json column unchanged", () => {
    const projection = projectDoc("notes/kitchen sink.md", KITCHEN_SINK);
    expect(projection.links.length).toBeGreaterThanOrEqual(9);
    expect(parseStoredProjection(JSON.stringify(projection))).toStrictEqual(projection);
  });
});
