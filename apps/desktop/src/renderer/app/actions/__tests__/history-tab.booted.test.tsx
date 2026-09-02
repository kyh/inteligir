// A refused history read must render as a failure: "No revisions yet" is a
// claim about the user's data, and a repo that could not answer has not made
// it. The refusal is the server's own — a path the vault refuses to read.

import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { bootTestApp } from "inteligir/server/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenNoteStoreProvider } from "@repo/editor/note/open-note-context";
import { createOpenNoteStore } from "@repo/editor/note/open-note-store";

import { HistoryTab } from "../history-tab";
import { createWorkspaceQueryClient } from "../../workspace-context";
import { routeRendererFetch } from "./booted-fetch";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mountTab(docPath: string): void {
  render(
    <QueryClientProvider client={createWorkspaceQueryClient()}>
      <OpenNoteStoreProvider store={createOpenNoteStore()}>
        <HistoryTab docPath={docPath} />
      </OpenNoteStoreProvider>
    </QueryClientProvider>,
  );
}

describe("the history tab under a refused read", () => {
  it("renders the refusal, never a false empty history", async () => {
    const booted = await bootTestApp();
    routeRendererFetch(booted);

    mountTab("../outside.md");
    await waitFor(() => {
      expect(screen.getByText("The history could not be read.")).toBeTruthy();
    });
    expect(screen.queryByText(/No revisions yet/u)).toBeNull();
  });

  it("keeps the honest empty state for a note with no commits yet", async () => {
    const booted = await bootTestApp();
    routeRendererFetch(booted);
    await booted.client.vault.write({ path: "fresh.md", content: "# Fresh\n" });

    mountTab("fresh.md");
    await waitFor(() => {
      expect(screen.getByText(/No revisions yet/u)).toBeTruthy();
    });
    expect(screen.queryByText("The history could not be read.")).toBeNull();
  });
});
