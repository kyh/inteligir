import { render, screen, waitFor } from "@testing-library/react";
import type { Value } from "platejs";
import { describe, expect, it } from "vitest";

import { createOpenNoteStore } from "@repo/editor/note/open-note-store";
import { buildResolver } from "@repo/notes/knowledge/link-resolve";

import { EditorHarness } from "./editor-harness";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";

const TARGET_PATH = "notes/deep/target.md";

const LISTING = ["hub.md", TARGET_PATH, "notes/assets/shot.png"];

const TARGET = [
  "Total so far: {{2+2|4}} items.",
  "",
  "![shot](../assets/shot.png)",
  "",
  "---",
  "",
  "```inteligir-chart",
  '{"type":"bar","title":"Chart","data":[{"label":"A","value":3}]}',
  "```",
  "",
].join("\n");

// every asset path the embed asked the host for; each answers missing, since jsdom has no object
// URLs to draw a real image with
const mountEmbed = (): string[] => {
  const resolver = buildResolver(LISTING);
  const fetched: string[] = [];
  installFakeEditorHost({
    readVaultAsset: (path) => {
      fetched.push(path);
      return { error: "asset 404", ok: false };
    },
    readVaultFile: (path) => (path === TARGET_PATH ? TARGET : null),
    resolveMdTarget: (target, fromPath) => resolver.resolveMd(target, fromPath),
    resolveWikiTarget: (target) => resolver.resolveWiki(target),
  });
  const store = createOpenNoteStore();
  store.publishOpenPath("hub.md");
  const value: Value = [
    {
      children: [
        { text: "" },
        { body: "target", children: [{ text: "" }], type: "wikiEmbed" },
        { text: "" },
      ],
      type: "p",
    },
  ];
  render(<EditorHarness value={value} store={store} />);
  return fetched;
};

describe("an embedded note's voids", () => {
  it("draw a formula pill's value, an image, a rule and a rich block's card", async () => {
    mountEmbed();

    const pill = await screen.findByText("4");
    expect(pill.getAttribute("title")).toBe("2+2");
    expect(await screen.findByText("Missing image: ../assets/shot.png")).toBeTruthy();
    expect(document.querySelector("hr")).not.toBeNull();
    expect(await screen.findByText("Open the note to see this block.")).toBeTruthy();
  });

  it("resolve an image's url from the embedded note, not the open one", async () => {
    const fetched = mountEmbed();
    await waitFor(() => {
      expect(fetched).toEqual(["notes/assets/shot.png"]);
    });
  });
});
