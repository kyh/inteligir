// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import type { Value } from "platejs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { LibraryBlock } from "@repo/notes/library/library-nodes";

import { EditorHarness } from "./test-support/editor-harness";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";

const HUB_ID = "0190a000-0000-7000-8000-00000000000a";
const TARGET_ID = "0190a000-0000-7000-8000-00000000000b";
const OTHER_ID = "0190a000-0000-7000-8000-00000000000c";
const SHA = "a".repeat(64);
const VOID: [{ text: "" }] = [{ text: "" }];

const TARGET: readonly LibraryBlock[] = [
  {
    children: [
      { text: "Total so far: " },
      { children: VOID, display: "4", source: "2+2", type: "formulaPill" },
      { text: " items." },
    ],
    id: "b1",
    type: "p",
  },
  {
    children: [
      { text: "See " },
      { children: VOID, itemId: OTHER_ID, title: "Other", type: "wikiLink" },
      { text: " and " },
      { children: [{ text: "Site" }], type: "a", url: "https://example.com/page" },
      { text: "." },
    ],
    id: "b2",
    type: "p",
  },
  { caption: [{ text: "A shot" }], children: VOID, id: "b3", sha: SHA, type: "img" },
  { children: VOID, id: "b4", type: "hr" },
  {
    children: VOID,
    id: "b5",
    type: "chart_block",
    value: '{"type":"bar","title":"Chart","data":[{"label":"A","value":3}]}',
  },
];

const embedOf = (title: string): Value => [
  {
    children: [
      { text: "" },
      { children: VOID, itemId: null, title, type: "wikiEmbed" },
      { text: "" },
    ],
    type: "p",
  },
];

// the target's blocks for `itemId` alone
const only = (itemId: string) =>
  function blocksOf(id: string): readonly LibraryBlock[] | null {
    return id === itemId ? TARGET : null;
  };

// jsdom has no object URLs to draw a real picture with
beforeAll(() => {
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:shot" });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => {} });
});

afterAll(() => {
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
});

const mountEmbed = (
  blocks: (itemId: string) => readonly LibraryBlock[] | null,
  title = "Target",
) => {
  const host = installFakeEditorHost({
    files: new Map([[SHA, new Blob([new Uint8Array([1])], { type: "image/png" })]]),
    itemBlocks: blocks,
    linkTargets: [
      { id: HUB_ID, title: "Hub" },
      { id: TARGET_ID, title: "Target" },
      { id: OTHER_ID, title: "Other" },
    ],
  });
  render(<EditorHarness itemId={HUB_ID} value={embedOf(title)} />);
  return host;
};

describe("an embedded item's blocks", () => {
  it("draw a formula pill's value, a picture by its sha, a rule and a rich block's card", async () => {
    mountEmbed(only(TARGET_ID));

    const pill = await screen.findByText("4");
    expect(pill.getAttribute("title")).toBe("2+2");
    await waitFor(() => {
      expect(document.querySelector('img[alt="A shot"]')?.getAttribute("src")).toBe("blob:shot");
    });
    expect(document.querySelector("hr")).not.toBeNull();
    await expect(screen.findByText("Open it to see this block.")).resolves.toBeTruthy();
  });

  it("are read again when the embedded item moves, and not when another does", async () => {
    let target: readonly LibraryBlock[] = TARGET;
    const reads: string[] = [];
    const host = mountEmbed((id) => {
      reads.push(id);
      return id === TARGET_ID ? target : null;
    });
    await screen.findByText("4");

    act(() => {
      host.changed(new Set([OTHER_ID]));
    });
    target = [{ children: [{ text: "Rewritten." }], id: "b1", type: "p" }];
    act(() => {
      host.changed(new Set([TARGET_ID]));
    });

    await expect(screen.findByText("Rewritten.")).resolves.toBeTruthy();
    expect(reads).toStrictEqual([TARGET_ID, TARGET_ID]);
  });

  it("are a chip while the device holds none of them", async () => {
    mountEmbed(() => null);
    await expect(screen.findByText("Target")).resolves.toBeTruthy();
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("are a chip while the device has their item but not yet its body, and drawn once it lands", async () => {
    // the host answers none for an item whose body is still to come, as both hosts do
    let pulled = false;
    const host = mountEmbed((id) => (id === TARGET_ID && pulled ? TARGET : null));
    await expect(screen.findByText("Target")).resolves.toBeTruthy();
    expect(screen.queryByText("This note is empty.")).toBeNull();

    pulled = true;
    act(() => {
      host.changed(new Set([TARGET_ID]));
    });

    await expect(screen.findByText("4")).resolves.toBeTruthy();
  });

  it("are never the open item's own, which embeds as a chip saying so", async () => {
    mountEmbed(only(HUB_ID), "Hub");
    await expect(screen.findByText("(circular)")).resolves.toBeTruthy();
    expect(screen.queryByText("4")).toBeNull();
  });
});

describe("an embedded item's links", () => {
  it("open a linked item in the app, by its id", async () => {
    const { calls } = mountEmbed(only(TARGET_ID));
    fireEvent.click(await screen.findByText("Other"));
    expect(calls).toContainEqual({ action: "openItem", args: [OTHER_ID] });
  });

  it("hand an http url to the browser", async () => {
    mountEmbed(only(TARGET_ID));
    const label = await screen.findByText("Site");
    const link = label.closest("a");
    expect(link?.getAttribute("href")).toBe("https://example.com/page");
    expect(link?.getAttribute("target")).toBe("_blank");
  });

  it("open the embedded item from its title", async () => {
    const { calls } = mountEmbed(only(TARGET_ID));
    await screen.findByText("4");
    fireEvent.click(screen.getByRole("button", { name: "Target" }));
    expect(calls).toContainEqual({ action: "openItem", args: [TARGET_ID] });
  });
});
