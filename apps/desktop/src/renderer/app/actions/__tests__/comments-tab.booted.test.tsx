import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { bootTestApp } from "inteligir/server/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommentsTab } from "../comments-tab";
import { createWorkspaceQueryClient } from "../../workspace-context";
import { routeRendererFetch } from "./booted-fetch";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mountTab(docPath: string): void {
  render(
    <QueryClientProvider client={createWorkspaceQueryClient()}>
      <CommentsTab docPath={docPath} focusIds={[]} />
    </QueryClientProvider>,
  );
}

describe("the comments tab under a refused read", () => {
  it("renders the refusal, never an eternal Loading…", async () => {
    const booted = await bootTestApp();
    routeRendererFetch(booted);
    writeFileSync(join(booted.vaultDir, "note.md"), "note\n", "utf8");
    writeFileSync(join(booted.vaultDir, "note.md.comments.json"), "{not json", "utf8");

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
