import { writeFileSync } from "node:fs";
import path from "node:path";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { bootTestApp } from "inteligir/server/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommentsTab } from "../comments-tab";
import { createWorkspaceQueryClient, WorkspaceProvider } from "../../workspace-context";
import { routeRendererFetch } from "./booted-fetch";
import { routeRendererSocket } from "./booted-socket";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mountTab = (docPath: string): void => {
  render(
    <QueryClientProvider client={createWorkspaceQueryClient()}>
      <CommentsTab docPath={docPath} focusIds={[]} />
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

describe("the comments tab over the live bus", () => {
  it("shows an agent's second comment with nothing else happening", async () => {
    const booted = await bootTestApp();
    routeRendererFetch(booted);
    routeRendererSocket(booted);
    writeFileSync(path.join(booted.vaultDir, "note.md"), "note\n", "utf-8");

    render(
      <WorkspaceProvider>
        <CommentsTab docPath="note.md" focusIds={[]} />
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
