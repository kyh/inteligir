import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getEditorHostActions } from "@repo/editor/host-io";
import { annotationsStorePath } from "@repo/notes/annotations/store-schema";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { bootTestApp } from "../../server/__tests__/boot-app";
import type { ShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnnotationsTab } from "@repo/workspace/app/actions/annotations-tab";
import type { AnnotationFocus } from "@repo/workspace/app/actions/annotations-tab";
import {
  createWorkspaceQueryClient,
  WorkspaceProvider,
} from "@repo/workspace/app/workspace-context";
import { countPageCalls, routePageFetch } from "./booted-fetch";
import { routePageSocket } from "./booted-socket";
import { bootWorkspace } from "./boot-workspace";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

const mountTab = (docPath: string, modifier: ShortcutModifier = "meta"): void => {
  render(
    <QueryClientProvider client={createWorkspaceQueryClient()}>
      <AnnotationsTab docPath={docPath} focus={null} modifier={modifier} />
    </QueryClientProvider>,
  );
};

describe("the annotations tab under a refused read", () => {
  it("renders the refusal, never an eternal Loading…", async () => {
    const booted = await bootTestApp();
    routePageFetch(booted);
    writeFileSync(path.join(booted.vaultDir, "note.md"), "---\nid: 7d1c\n---\nnote\n", "utf-8");
    const store = path.join(booted.vaultDir, annotationsStorePath("7d1c"));
    mkdirSync(path.dirname(store), { recursive: true });
    writeFileSync(store, "{not json", "utf-8");

    mountTab("note.md");
    await waitFor(() => {
      expect(screen.getByText("The highlights could not be read.")).toBeTruthy();
    });
    expect(screen.queryByText("Loading…")).toBeNull();
    expect(screen.getByText(/\.inteligir\/annotations\/7d1c\.json/u)).toBeTruthy();
  });

  it("still tells a settled empty apart from a failure, spelling the chord for the keyboard", async () => {
    const booted = await bootTestApp();
    routePageFetch(booted);

    mountTab("note.md", "ctrl");
    await waitFor(() => {
      expect(
        screen.getByText("No highlights yet. Select text and press Ctrl+Shift+H."),
      ).toBeTruthy();
    });
    expect(screen.queryByText("The highlights could not be read.")).toBeNull();
  });
});

describe("the annotations tab over the live bus", () => {
  it("shows an agent's second annotation with nothing else happening", async () => {
    const booted = await bootTestApp();
    routePageFetch(booted);
    routePageSocket(booted);
    writeFileSync(path.join(booted.vaultDir, "note.md"), "note\n", "utf-8");

    render(
      <WorkspaceProvider>
        <AnnotationsTab docPath="note.md" focus={null} modifier="meta" />
      </WorkspaceProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText(/No highlights yet/u)).toBeTruthy();
    });

    // the first creates the store, which the listing announces; the second only rewrites it.
    await booted.client.annotations.add({
      id: "c1",
      path: "note.md",
      quote: "the passage",
      source: "agent",
      text: "first",
    });
    await waitFor(() => {
      expect(screen.getByText("first")).toBeTruthy();
    });
    await booted.client.annotations.add({
      id: "c2",
      path: "note.md",
      quote: "note",
      source: "agent",
      text: "second",
    });
    await waitFor(() => {
      expect(screen.getByText("second")).toBeTruthy();
    });
  });
});

describe("a focus from the note", () => {
  it("scrolls to the focused annotation, and again on a new click", async () => {
    const booted = await bootTestApp();
    routePageFetch(booted);
    await booted.client.vault.write({
      content: "# Plan\n",
      guard: { kind: "overwrite" },
      path: "plan.md",
    });
    await booted.client.annotations.add({
      id: "c1",
      path: "plan.md",
      quote: "Plan",
      text: "Ship it?",
    });
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");

    const queryClient = createWorkspaceQueryClient();
    const tabFocusedOn = (focus: AnnotationFocus) => (
      <QueryClientProvider client={queryClient}>
        <AnnotationsTab docPath="plan.md" focus={focus} modifier="meta" />
      </QueryClientProvider>
    );
    const view = render(tabFocusedOn({ ids: ["c1"], nonce: 1 }));

    expect(await screen.findByText("Ship it?")).toBeDefined();
    expect(screen.getByText("Plan")).toBeDefined();
    expect(scrolled).toHaveBeenCalledTimes(1);
    expect(scrolled).toHaveBeenCalledWith({ block: "nearest" });

    view.rerender(tabFocusedOn({ ids: ["c1"], nonce: 2 }));
    expect(screen.getByText("Ship it?")).toBeDefined();
    expect(scrolled).toHaveBeenCalledTimes(2);
  });
});

describe("an Enter in a reply", () => {
  it("commits an IME candidate rather than sending the half-composed reply", async () => {
    const booted = await bootTestApp();
    routePageFetch(booted);
    await booted.client.vault.write({
      content: "# Plan\n",
      guard: { kind: "overwrite" },
      path: "plan.md",
    });
    await booted.client.annotations.add({
      id: "c1",
      path: "plan.md",
      quote: "the passage",
      text: "Ship it?",
    });

    mountTab("plan.md");
    const field = await screen.findByLabelText("Reply");
    fireEvent.change(field, { target: { value: "日本" } });
    fireEvent.keyDown(field, { isComposing: true, key: "Enter" });
    fireEvent.change(field, { target: { value: "日本語" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => {
      expect(field).toHaveProperty("value", "");
    });
    const { annotations } = await booted.client.annotations.list({ path: "plan.md" });
    expect(
      annotations.flatMap((annotation) => annotation.replies.map((row) => row.entry.text)),
    ).toEqual(["日本語"]);
  });
});

// an item with one bare highlight around "marked words"
const annotated = async () => {
  const booted = await bootTestApp();
  routePageFetch(booted);
  await booted.client.vault.write({
    content: "---\nid: 9a1f\n---\nThe %%i:h1:start%%marked words%%i:h1:end%% stay.\n",
    guard: { kind: "overwrite" },
    path: "plan.md",
  });
  await booted.client.annotations.add({ id: "h1", path: "plan.md", quote: "marked words" });
  return booted;
};

describe("a highlight's card", () => {
  it("shows the highlighted words, offers a note, and writes the one typed in place", async () => {
    const booted = await annotated();
    mountTab("plan.md");

    expect(await screen.findByText("marked words")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
    const field = screen.getByLabelText("Note");
    fireEvent.change(field, { target: { value: "Worth a second read" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(async () => {
      const { annotations } = await booted.client.annotations.list({ path: "plan.md" });
      expect(annotations.map((annotation) => annotation.root.text)).toEqual([
        "Worth a second read",
      ]);
    });
    expect(await screen.findByRole("button", { name: "Edit the note" })).toBeTruthy();
  });

  it("keeps the note as it was on Escape", async () => {
    const booted = await annotated();
    mountTab("plan.md");

    fireEvent.click(await screen.findByRole("button", { name: "Add a note" }));
    const field = screen.getByLabelText("Note");
    fireEvent.change(field, { target: { value: "dropped" } });
    fireEvent.keyDown(field, { key: "Escape" });

    expect(screen.queryByLabelText("Note")).toBeNull();
    const { annotations } = await booted.client.annotations.list({ path: "plan.md" });
    expect(annotations.map((annotation) => annotation.root.text)).toEqual([""]);
  });

  it("removes the highlight with its entry", async () => {
    const booted = await annotated();
    mountTab("plan.md");

    fireEvent.click(await screen.findByRole("button", { name: "Remove highlight" }));
    await waitFor(() => {
      expect(screen.getByText(/No highlights yet/u)).toBeTruthy();
    });
    const { annotations } = await booted.client.annotations.list({ path: "plan.md" });
    expect(annotations).toEqual([]);
  });

  it("groups one whose markers are gone under No longer in the text", async () => {
    const booted = await bootTestApp();
    routePageFetch(booted);
    await booted.client.vault.write({
      content: "---\nid: 9a1f\n---\nNo markers here.\n",
      guard: { kind: "overwrite" },
      path: "plan.md",
    });
    await booted.client.annotations.add({ id: "h2", path: "plan.md", quote: "gone words" });
    mountTab("plan.md");

    const group = await screen.findByRole("region", { name: "No longer in the text" });
    expect(group.textContent).toContain("gone words");
    expect(screen.getByRole("button", { name: "Remove" })).toBeTruthy();
  });
});

const findCard = async (id: string): Promise<HTMLElement> =>
  await waitFor(() => {
    const card = document.querySelector<HTMLElement>(`[data-annotation-id="${id}"]`);
    if (card === null) {
      throw new Error(`no card for ${id}`);
    }
    return card;
  });

describe("a note written on the open item's highlight", () => {
  it("lands in the tab on the write's own answer, with no second read of the list", async () => {
    const harness = await bootWorkspace({
      item: "plan.md",
      seed: async ({ client }) => {
        await client.vault.write({
          content: "---\nid: 9a1f\n---\nThe %%i:h1:start%%marked words%%i:h1:end%% stay.\n",
          guard: { kind: "overwrite" },
          path: "plan.md",
        });
        await client.annotations.add({ id: "h1", path: "plan.md", quote: "marked words" });
      },
    });
    const calls = countPageCalls(harness);
    act(() => {
      getEditorHostActions().annotations.open(["h1"]);
    });
    const card = within(await findCard("h1"));
    expect(card.getByRole("button", { name: "Add a note" })).toBeTruthy();
    const listReads = calls("annotations/list");

    let edited = false;
    await act(async () => {
      edited = await getEditorHostActions().annotations.edit("h1", "Worth a second read");
    });

    expect(edited).toBe(true);
    await waitFor(() => {
      expect(card.getByRole("button", { name: "Edit the note" }).textContent).toBe(
        "Worth a second read",
      );
    });
    expect(calls("annotations/list")).toBe(listReads);
  });
});
