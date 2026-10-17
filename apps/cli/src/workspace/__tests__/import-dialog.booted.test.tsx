import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "@repo/ui/components/sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";

import { RaindropImport, UNREADABLE_SENTENCE } from "@repo/workspace/app/library/raindrop-import";
import type { RaindropImportHandle } from "@repo/workspace/app/library/raindrop-import";
import { createWorkspaceQueryClient } from "@repo/workspace/app/workspace-context";
import { bootTestApp } from "../../server/__tests__/boot-app";
import { routePageFetch } from "./booted-fetch";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const mountImport = () => {
  const handle = createRef<RaindropImportHandle>();
  render(
    <QueryClientProvider client={createWorkspaceQueryClient()}>
      <RaindropImport handleRef={handle} />
    </QueryClientProvider>,
  );
  const field = screen.getByLabelText("Raindrop backup");
  if (!(field instanceof HTMLInputElement)) {
    throw new Error("the chooser is a file field");
  }
  return { field, handle };
};

const choose = (field: HTMLInputElement, file: File): void => {
  fireEvent.change(field, { target: { files: [file] } });
};

describe("a Raindrop import from the window", () => {
  it("opens the file chooser for the press that asked", async () => {
    const booted = await bootTestApp();
    routePageFetch(booted);
    const { field, handle } = mountImport();
    const opened = vi.spyOn(field, "click");

    act(() => {
      handle.current?.choose();
    });
    expect(opened).toHaveBeenCalledOnce();
    expect(field.accept).toBe(".csv,text/csv");
  });

  it("says how to make a backup when the file is not one, and writes nothing", async () => {
    const booted = await bootTestApp();
    routePageFetch(booted);
    const refused = vi.spyOn(toast, "error");
    const { field } = mountImport();

    choose(field, new File(["just some words\n"], "notes.txt", { type: "text/plain" }));

    await waitFor(() => {
      expect(refused).toHaveBeenCalledWith(UNREADABLE_SENTENCE);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    const { job } = await booted.client.imports.status();
    expect(job).toBeNull();
  });
});
