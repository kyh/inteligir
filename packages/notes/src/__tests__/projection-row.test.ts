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
  "> [!NOTE]",
  "> Inside a callout: [[Called Out]] #inside",
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

const SAVED_LINK = [
  "---",
  "id: 7d2f9e40-1c6b-4a8e-9f31-5b0a6c2e8d17",
  "kind: link",
  "url: https://stephango.com/file-over-app",
  "site: Steph Ango",
  "saved: 2026-10-17T09:12:30Z",
  "fetched: 2026-10-17T09:12:33Z",
  `description: ${"long words ".repeat(40).trim()}`,
  "tags: [reading]",
  "---",
  "![](assets/covers/3f9a0c2b1d4e5f60.jpg)",
  "",
  "%%i:abc:start%%For%%i:abc:end%% Tuesday, see [[Other note|the other]]   and #later.",
  "",
  "File over app is a philosophy.",
  "",
].join("\n");

describe("an item's projection", () => {
  it("carries its facts and preview, and round-trips them", () => {
    const projection = projectDoc("Unsorted/File over app.md", SAVED_LINK);
    expect(projection.item).toMatchObject({
      hasId: true,
      host: "stephango.com",
      kind: "link",
      site: "Steph Ango",
      urlKey: "stephango.com/file-over-app",
    });
    expect(projection.item.description?.length).toBe(200);
    expect(projection.item.description?.endsWith("…")).toBe(true);
    expect(projection.preview).toBe("For Tuesday, see the other and #later.");
    expect(parseStoredProjection(JSON.stringify(projection))).toStrictEqual(projection);
  });

  it("takes a saved page's tags from its frontmatter alone, and a note's from its text too", () => {
    expect(projectDoc("a.md", SAVED_LINK).tags).toEqual(["reading"]);
    expect(projectDoc("b.md", SAVED_LINK.replace("kind: link\n", "")).tags).toEqual([
      "reading",
      "later",
    ]);
  });

  it("clips the preview to 140 and gives none to a doc whose paragraphs hold no text", () => {
    const long = projectDoc("c.md", `# Title\n\n${"word ".repeat(60)}\n`).preview;
    expect(long.length).toBe(140);
    expect(long.endsWith("…")).toBe(true);
    expect(projectDoc("d.md", "# Only a heading\n\n![](pic.png)\n").preview).toBe("");
  });
});
