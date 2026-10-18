// @vitest-environment jsdom

import type { ImportJob } from "@repo/contract/local/imports/imports-schema";
import { toast } from "@repo/ui/components/sonner";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { stubRpc } from "../../__tests__/rpc-stub";
import { createWorkspaceQueryClient } from "../../workspace-context";
import { ImportRow } from "../import-row";

const RUNNING: ImportJob = {
  added: 2,
  alreadySaved: 1,
  finishedAt: null,
  highlights: 0,
  id: "imp_1",
  message: null,
  source: "raindrop",
  startedAt: 1_700_000_000_000,
  state: "running",
  total: 10,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the rail's import row", () => {
  it("stops the running job, then says what it added", async () => {
    let job = RUNNING;
    const cancelled = vi.fn();
    stubRpc({
      "imports/cancel": (input) => {
        cancelled(input);
        job = { ...RUNNING, finishedAt: 1_700_000_001_000, state: "cancelled" };
        return { job };
      },
      "imports/status": () => ({ job }),
    });
    const stopped = vi.spyOn(toast, "info");
    render(
      <QueryClientProvider client={createWorkspaceQueryClient()}>
        <ImportRow onShowLibrary={vi.fn()} />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Stop" }));

    await waitFor(() => {
      expect(stopped).toHaveBeenCalledWith("Import stopped. 2 items from Raindrop were added.");
    });
    expect(cancelled).toHaveBeenCalledWith({ id: "imp_1" });
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  });
});
