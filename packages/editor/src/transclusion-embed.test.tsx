// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import type { Value } from "platejs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { LibraryBlock } from "@repo/notes/library/library-nodes";

import { EMBED_PART_GONE } from "@repo/editor/transclusion-guard";
import { WIKI_INPUT_KEY } from "@repo/editor/wiki/wiki-input-key";

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

const SECTIONS: readonly LibraryBlock[] = [
  { children: [{ text: "Intro" }], id: "s0", type: "h1" },
  { children: [{ text: "Before it." }], id: "s1", type: "p" },
  { children: [{ text: "Roll Back" }], id: "s2", type: "h2" },
  { children: [{ text: "In the section." }], id: "s3", ref: "step", type: "p" },
  { children: [{ text: "Deeper" }], id: "s4", type: "h3" },
  { children: [{ text: "Still in it." }], id: "s5", type: "p" },
  { children: [{ text: "Next" }], id: "s6", type: "h2" },
  { children: [{ text: "After it." }], id: "s7", type: "p" },
];

interface Anchor {
  readonly blockRef?: string;
  readonly heading?: string;
}

const embedOf = (title: string, anchor: Anchor): Value => [
  {
    children: [
      { text: "" },
      { ...anchor, children: VOID, itemId: null, title, type: "wikiEmbed" },
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
  anchor: Anchor = {},
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
  render(<EditorHarness itemId={HUB_ID} value={embedOf(title, anchor)} />);
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

const sections = (id: string) => (id === TARGET_ID ? SECTIONS : null);

describe("an embed of part of an item", () => {
  it("draws one heading's section, up to a heading of the same level", async () => {
    mountEmbed(sections, "Target", { heading: "Roll Back" });

    await expect(screen.findByText("In the section.")).resolves.toBeTruthy();
    expect(screen.getByText("Still in it.")).toBeTruthy();
    expect(screen.queryByText("Before it.")).toBeNull();
    expect(screen.queryByText("After it.")).toBeNull();
  });

  it("ends a section at a heading above it", async () => {
    mountEmbed(sections, "Target", { heading: "Deeper" });

    await expect(screen.findByText("Still in it.")).resolves.toBeTruthy();
    expect(screen.queryByText("After it.")).toBeNull();
    expect(screen.queryByText("In the section.")).toBeNull();
  });

  it("forgives a heading's case and spacing", async () => {
    mountEmbed(sections, "Target", { heading: "rollback" });

    await expect(screen.findByText("In the section.")).resolves.toBeTruthy();
    expect(screen.queryByText("Before it.")).toBeNull();
  });

  it("draws one block by its ref", async () => {
    mountEmbed(sections, "Target", { blockRef: "step" });

    await expect(screen.findByText("In the section.")).resolves.toBeTruthy();
    expect(screen.queryByText("Still in it.")).toBeNull();
    expect(screen.queryByText("Roll Back")).toBeNull();
  });

  it.each<Anchor>([{ heading: "Nowhere" }, { blockRef: "nowhere" }])(
    "says so when %j is gone, and draws nothing else",
    async (anchor) => {
      mountEmbed(sections, "Target", anchor);

      await expect(screen.findByText(EMBED_PART_GONE)).resolves.toBeTruthy();
      expect(screen.queryByText("Before it.")).toBeNull();
    },
  );
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

const linkOf = (
  fields: { readonly itemId: string | null; readonly title: string; readonly heading?: string },
  type: "wikiLink" | "wikiEmbed" = "wikiLink",
): Value => [
  { children: [{ text: "" }, { ...fields, children: VOID, type }, { text: "" }], type: "p" },
];

// the target goes by `title`, which is empty for an item not named yet
const mountLink = (value: Value, title = "") => {
  const host = installFakeEditorHost({
    itemBlocks: only(TARGET_ID),
    linkTargets: [
      { id: HUB_ID, title: "Hub" },
      { id: TARGET_ID, title },
    ],
  });
  render(<EditorHarness itemId={HUB_ID} value={value} />);
  return host;
};

describe("a link written to an item with no title", () => {
  it("is called Untitled, and opens its item", async () => {
    const { calls } = mountLink(linkOf({ itemId: TARGET_ID, title: "" }));
    fireEvent.click(await screen.findByRole("button", { name: "Untitled" }));
    expect(calls).toContainEqual({ action: "openItem", args: [TARGET_ID] });
  });

  it("goes by the name its item takes, and opens it", async () => {
    const { calls } = mountLink(linkOf({ itemId: TARGET_ID, title: "" }), "Named since");
    fireEvent.click(await screen.findByRole("button", { name: "Named since" }));
    expect(calls).toContainEqual({ action: "openItem", args: [TARGET_ID] });
  });

  it("embeds its item", async () => {
    mountLink(linkOf({ itemId: TARGET_ID, title: "" }, "wikiEmbed"));
    await expect(screen.findByText("4")).resolves.toBeTruthy();
  });

  it("offers nothing to create once its item is gone, since it has no name to create", async () => {
    const { calls } = mountLink(linkOf({ itemId: OTHER_ID, title: "" }));
    fireEvent.click(await screen.findByRole("button", { name: "Untitled" }));
    expect(screen.queryByText("Create")).toBeNull();
    expect(calls).toStrictEqual([]);
  });
});

describe("the link picker", () => {
  it("calls an item with no title Untitled", async () => {
    installFakeEditorHost({ linkTargets: [{ id: TARGET_ID, title: "" }] });
    const value: Value = [
      {
        children: [{ text: "" }, { children: [{ text: "" }], type: WIKI_INPUT_KEY }, { text: "" }],
        type: "p",
      },
    ];
    render(<EditorHarness itemId={HUB_ID} value={value} />);
    await expect(screen.findByRole("option", { name: "Untitled" })).resolves.toBeDefined();
  });
});

describe("a link to a place in its own item", () => {
  it("opens nothing and offers nothing to create", async () => {
    const { calls } = mountLink(linkOf({ heading: "Rollback", itemId: null, title: "" }));
    fireEvent.click(await screen.findByRole("button", { name: "#Rollback" }));
    expect(screen.queryByText("Create")).toBeNull();
    expect(calls).toStrictEqual([]);
  });
});
