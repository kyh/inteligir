import { writeFileSync } from "node:fs";
import path from "node:path";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { bootTestApp } from "inteligir/server/testing";
import type { ShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommentsTab } from "../comments-tab";
import type { CommentFocus } from "../comments-tab";
import { createWorkspaceQueryClient, WorkspaceProvider } from "../../workspace-context";
import { routeRendererFetch } from "./booted-fetch";
import { routeRendererSocket } from "./booted-socket";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const mountTab = (docPath: string, modifier: ShortcutModifier = "meta"): void => {
  render(
    <QueryClientProvider client={createWorkspaceQueryClient()}>
      <CommentsTab docPath={docPath} focus={null} modifier={modifier} />
    </QueryClientProvider>,
  );
};

describe("the comments tab under a refused read", () => {
  it("renders the refusal, never an eternal Loading…", async () => {
    const booted = await bootTestApp();
    routeRendererFetch(booted);
    writeFileSync(path.join(booted.vaultDir, "note.md"), "note\n", "utf-8");
    writeFileSync(path.join(booted.vaultDir, "note.md.comments.json"), "{not json", "utf-8");

    mountTab("note.md");
    await waitFor(() => {
      expect(screen.getByText("The comments could not be read.")).toBeTruthy();
    });
    expect(screen.queryByText("Loading…")).toBeNull();
    expect(screen.getByText(/note\.md\.comments\.json/u)).toBeTruthy();
  });

  it("still tells a settled empty apart from a failure, spelling the chord for the keyboard", async () => {
    const booted = await bootTestApp();
    routeRendererFetch(booted);

    mountTab("note.md", "ctrl");
    await waitFor(() => {
      expect(screen.getByText("No comments yet. Select text and press Ctrl+Shift+A.")).toBeTruthy();
    });
    expect(screen.queryByText("The comments could not be read.")).toBeNull();
  });
});

describe("the comments tab over the live bus", () => {
  it("shows an agent's second comment with nothing else happening", async () => {
    const booted = await bootTestApp();
    routeRendererFetch(booted);
    routeRendererSocket(booted);
    writeFileSync(path.join(booted.vaultDir, "note.md"), "note\n", "utf-8");

    render(
      <WorkspaceProvider>
        <CommentsTab docPath="note.md" focus={null} modifier="meta" />
      </WorkspaceProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText(/No comments yet/u)).toBeTruthy();
    });

    // the first creates the store, which the listing announces; the second only rewrites it.
    await booted.client.comments.add({ id: "c1", path: "note.md", source: "agent", text: "first" });
    await waitFor(() => {
      expect(screen.getByText("first")).toBeTruthy();
    });
    await booted.client.comments.add({
      id: "c2",
      path: "note.md",
      source: "agent",
      text: "second",
    });
    await waitFor(() => {
      expect(screen.getByText("second")).toBeTruthy();
    });
  });
});

describe("a focus from the note", () => {
  it("shows and scrolls to a resolved thread, lets Hide hide it, and a new click shows it again", async () => {
    const booted = await bootTestApp();
    routeRendererFetch(booted);
    await booted.client.vault.write({
      content: "# Plan\n",
      guard: { kind: "overwrite" },
      path: "plan.md",
    });
    await booted.client.comments.add({ id: "c1", path: "plan.md", text: "Ship it?" });
    await booted.client.comments.resolve({ id: "c1", path: "plan.md", resolved: true });
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");

    const queryClient = createWorkspaceQueryClient();
    const tabFocusedOn = (focus: CommentFocus) => (
      <QueryClientProvider client={queryClient}>
        <CommentsTab docPath="plan.md" focus={focus} modifier="meta" />
      </QueryClientProvider>
    );
    const view = render(tabFocusedOn({ ids: ["c1"], nonce: 1 }));

    expect(await screen.findByText("Ship it?")).toBeDefined();
    expect(scrolled).toHaveBeenCalledTimes(1);
    expect(scrolled).toHaveBeenCalledWith({ block: "nearest" });

    fireEvent.click(screen.getByRole("button", { name: "Hide resolved (1)" }));
    expect(screen.queryByText("Ship it?")).toBeNull();

    view.rerender(tabFocusedOn({ ids: ["c1"], nonce: 2 }));
    expect(screen.getByText("Ship it?")).toBeDefined();
    expect(scrolled).toHaveBeenCalledTimes(2);
  });
});

describe("an Enter in a reply", () => {
  it("commits an IME candidate rather than sending the half-composed reply", async () => {
    const booted = await bootTestApp();
    routeRendererFetch(booted);
    await booted.client.vault.write({ content: "# Plan\n", path: "plan.md" });
    await booted.client.comments.add({ id: "c1", path: "plan.md", text: "Ship it?" });

    mountTab("plan.md");
    const field = await screen.findByLabelText("Reply to comment");
    fireEvent.change(field, { target: { value: "日本" } });
    fireEvent.keyDown(field, { isComposing: true, key: "Enter" });
    fireEvent.change(field, { target: { value: "日本語" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => {
      expect(field).toHaveProperty("value", "");
    });
    const { threads } = await booted.client.comments.list({ path: "plan.md" });
    expect(threads.flatMap((thread) => thread.replies.map((row) => row.entry.text))).toEqual([
      "日本語",
    ]);
  });
});
