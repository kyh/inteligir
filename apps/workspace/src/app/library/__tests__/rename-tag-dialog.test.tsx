// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { orpc } from "../../api";
import { stubRpc } from "../../__tests__/rpc-stub";
import { createWorkspaceQueryClient } from "../../workspace-context";
import { RenameTagDialog } from "../rename-tag-dialog";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a tag's rename", () => {
  it("refetches the tags and listings it rewrote, and leaves the link targets", async () => {
    stubRpc({
      "knowledge/renameTag": () => ({
        from: "project",
        rewritten: ["Unsorted/essay.md"],
        skipped: [],
        to: "work",
      }),
    });
    const queryClient = createWorkspaceQueryClient();
    queryClient.setQueryData(orpc.knowledge.wikiTargets.queryKey(), { targets: [] });
    queryClient.setQueryData(orpc.knowledge.tags.queryKey(), { tags: [], total: 0 });
    queryClient.setQueryData(orpc.knowledge.scopes.queryKey(), {
      folders: [],
      total: 0,
      unsorted: 0,
      untagged: 0,
    });
    const onRenamed = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <RenameTagDialog tag="project" onOpenChange={vi.fn()} onRenamed={onRenamed} />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText("New tag name"), { target: { value: "#work" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));

    await waitFor(() => {
      expect(onRenamed).toHaveBeenCalledWith("project", "work");
    });
    const invalidated = (queryKey: readonly unknown[]): boolean | undefined =>
      queryClient.getQueryState(queryKey)?.isInvalidated;
    expect(invalidated(orpc.knowledge.tags.queryKey())).toBe(true);
    expect(invalidated(orpc.knowledge.scopes.queryKey())).toBe(true);
    expect(invalidated(orpc.knowledge.wikiTargets.queryKey())).toBe(false);
  });
});
