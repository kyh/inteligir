import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Value } from "platejs";
import { describe, expect, it } from "vitest";

import { createOpenNoteStore } from "@repo/editor/note/open-note-store";
import { buildResolver } from "@repo/notes/knowledge/link-resolve";

import { EditorHarness } from "./editor-harness";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";

const TARGET_PATH = "notes/deep/target.md";

const LISTING = ["hub.md", TARGET_PATH, "notes/deep/other.md", "notes/assets/shot.png"];

const TARGET = [
  "Total so far: {{2+2|4}} items.",
  "",
  "See [Other](other.md) and [Site](https://example.com/page).",
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

// `fetched` is every asset path the embed asked the host for; each answers missing, since jsdom
// has no object URLs to draw a real image with
const mountEmbed = () => {
  const resolver = buildResolver(LISTING);
  const fetched: string[] = [];
  const { calls } = installFakeEditorHost({
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
  return { calls, fetched };
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
    const { fetched } = mountEmbed();
    await waitFor(() => {
      expect(fetched).toEqual(["notes/assets/shot.png"]);
    });
  });
});

describe("an embedded note's links", () => {
  it("open a vault url in the app, resolved from the embedded note", async () => {
    const { calls } = mountEmbed();
    const label = await screen.findByText("Other");
    const link = label.closest("a");
    expect(link).not.toBeNull();
    expect(link?.hasAttribute("href")).toBe(false);
    expect(link?.hasAttribute("target")).toBe(false);
    if (link !== null) {
      fireEvent.click(link);
    }
    expect(calls).toContainEqual({ action: "openFile", args: ["notes/deep/other.md"] });
  });

  it("hand an http url to the browser", async () => {
    mountEmbed();
    const label = await screen.findByText("Site");
    const link = label.closest("a");
    expect(link?.getAttribute("href")).toBe("https://example.com/page");
    expect(link?.getAttribute("target")).toBe("_blank");
  });
});
