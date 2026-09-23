// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import type { Value } from "platejs";
import { describe, expect, it } from "vitest";

import { createOpenNoteStore } from "@repo/editor/note/open-note-store";
import { buildResolver } from "@repo/notes/knowledge/link-resolve";

import { EditorHarness } from "./editor-harness";
import { installFakeEditorHost } from "./fake-editor-host";

const LISTING = ["a/x y.png", "b/c/doc.md"];

// every path the node asked the host for; the host answers each as missing, since jsdom has no
// object URLs to draw a real one with
const mountImage = (notePath: string, url: string): string[] => {
  const resolver = buildResolver(LISTING);
  const fetched: string[] = [];
  installFakeEditorHost({
    readVaultAsset: (path) => {
      fetched.push(path);
      return { error: "asset 404", ok: false };
    },
    resolveMdTarget: (target, fromPath) => resolver.resolveMd(target, fromPath),
  });
  const store = createOpenNoteStore();
  store.publishOpenPath(notePath);
  const value: Value = [{ caption: [{ text: "" }], children: [{ text: "" }], type: "img", url }];
  render(<EditorHarness value={value} store={store} />);
  return fetched;
};

describe("an image's src, read and resolved as the knowledge index does", () => {
  it("fetches a moved note's re-based, percent-encoded url from beside the note", async () => {
    const fetched = mountImage("b/c/doc.md", "../../a/x%20y.png");
    await waitFor(() => {
      expect(fetched).toEqual(["a/x y.png"]);
    });
  });

  it("falls back to the decoded url as a root path while the listing lacks the file", async () => {
    const fetched = mountImage("b/c/doc.md", "assets/new%20shot.png");
    await waitFor(() => {
      expect(fetched).toEqual(["assets/new shot.png"]);
    });
  });

  it("asks the host for nothing when no vault path answers the url", async () => {
    const fetched = mountImage("b/c/doc.md", "mailto:a@b.c");
    expect(await screen.findByText("Missing image: mailto:a@b.c")).toBeTruthy();
    expect(fetched).toEqual([]);
  });
});
