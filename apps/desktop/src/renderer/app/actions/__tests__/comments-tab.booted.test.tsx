import { writeFileSync } from "node:fs";
import path from "node:path";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { bootTestApp } from "inteligir/server/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommentsTab } from "../comments-tab";
import type { CommentFocus } from "../comments-tab";
import { createWorkspaceQueryClient } from "../../workspace-context";
import { routeRendererFetch } from "./booted-fetch";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const mountTab = (docPath: string): void => {
  render(
    <QueryClientProvider client={createWorkspaceQueryClient()}>
      <CommentsTab docPath={docPath} focus={null} />
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

  it("still tells a settled empty apart from a failure", async () => {
    const booted = await bootTestApp();
    routeRendererFetch(booted);

    mountTab("note.md");
    await waitFor(() => {
      expect(screen.getByText(/No comments yet/u)).toBeTruthy();
    });
    expect(screen.queryByText("The comments could not be read.")).toBeNull();
  });
});

describe("a focus from the note", () => {
  it("shows and scrolls to a resolved thread, lets Hide hide it, and a new click shows it again", async () => {
    const booted = await bootTestApp();
    routeRendererFetch(booted);
    await booted.client.vault.write({ content: "# Plan\n", path: "plan.md" });
    await booted.client.comments.add({ id: "c1", path: "plan.md", text: "Ship it?" });
    await booted.client.comments.resolve({ id: "c1", path: "plan.md", resolved: true });
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");

    const queryClient = createWorkspaceQueryClient();
    const tabFocusedOn = (focus: CommentFocus) => (
      <QueryClientProvider client={queryClient}>
        <CommentsTab docPath="plan.md" focus={focus} />
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
