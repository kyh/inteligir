// @vitest-environment jsdom

import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";
import { buildResolver } from "@repo/notes/knowledge/link-resolve";
import { SidebarProvider } from "@repo/ui/components/sidebar-core";
import { toast } from "@repo/ui/components/sonner";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NoteTopbar } from "../note-topbar";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// the host's resolver over this listing, as the vault installs it
const copiedAfterClick = async (
  path: string,
  listing: readonly string[],
): Promise<string | undefined> => {
  installFakeEditorHost({ resolveWikiTarget: buildResolver(listing).resolveWiki });
  const writeText = vi.fn<Clipboard["writeText"]>().mockResolvedValue();
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  render(
    <SidebarProvider>
      <NoteTopbar
        path={path}
        railOpen
        onToggleRail={vi.fn<() => void>()}
        canBack={false}
        canForward={false}
        onBack={vi.fn<() => void>()}
        onForward={vi.fn<() => void>()}
        onFindInNote={vi.fn<() => void>()}
        onOpenFolder={vi.fn<() => void>()}
        insetTitleBar={false}
        commentCount={0}
        onOpenComments={vi.fn<() => void>()}
        onExportPdf={vi.fn<() => void>()}
      />
    </SidebarProvider>,
  );
  fireEvent.click(screen.getByLabelText("More"));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Copy link" }));
  return writeText.mock.calls[0]?.[0];
};

describe("copy link", () => {
  it("copies the note's wiki link by its name when no other note answers to it", async () => {
    expect(await copiedAfterClick("Plans/Weekly Plan.md", ["Plans/Weekly Plan.md", "b.md"])).toBe(
      "[[Weekly Plan]]",
    );
  });

  it("qualifies the link when another note shares the name", async () => {
    expect(
      await copiedAfterClick("Plans/Weekly Plan.md", ["Weekly Plan.md", "Plans/Weekly Plan.md"]),
    ).toBe("[[Plans/Weekly Plan]]");
  });

  it("copies nothing, and says so, for a name no link can carry", async () => {
    const refused = vi.spyOn(toast, "error");
    expect(await copiedAfterClick("Draft [v2].md", ["Draft [v2].md"])).toBeUndefined();
    expect(refused).toHaveBeenCalledOnce();
  });
});

describe("the note's name in the bar", () => {
  it("hides the extension the domain hides, whatever its case", () => {
    render(
      <SidebarProvider>
        <NoteTopbar
          path="Notes.MD"
          railOpen
          onToggleRail={vi.fn<() => void>()}
          canBack={false}
          canForward={false}
          onBack={vi.fn<() => void>()}
          onForward={vi.fn<() => void>()}
          onFindInNote={vi.fn<() => void>()}
          onOpenFolder={vi.fn<() => void>()}
          insetTitleBar={false}
          commentCount={0}
          onOpenComments={vi.fn<() => void>()}
          onExportPdf={vi.fn<() => void>()}
        />
      </SidebarProvider>,
    );
    expect(screen.getByText("Notes")).toBeDefined();
  });
});

describe("the folder breadcrumb", () => {
  it("names each folder on the way and scopes the rail to the one clicked", () => {
    const onOpenFolder = vi.fn<(folder: string) => void>();
    render(
      <SidebarProvider>
        <NoteTopbar
          path="a/b/c.md"
          railOpen
          onToggleRail={vi.fn<() => void>()}
          canBack={false}
          canForward={false}
          onBack={vi.fn<() => void>()}
          onForward={vi.fn<() => void>()}
          onFindInNote={vi.fn<() => void>()}
          onOpenFolder={onOpenFolder}
          insetTitleBar={false}
          commentCount={0}
          onOpenComments={vi.fn<() => void>()}
          onExportPdf={vi.fn<() => void>()}
        />
      </SidebarProvider>,
    );
    const crumbs = screen.getByRole("navigation", { name: "Note location" });
    expect(crumbs.textContent).toBe("a›b›c");
    fireEvent.click(screen.getByRole("button", { name: "a" }));
    expect(onOpenFolder).toHaveBeenCalledWith("a");
    fireEvent.click(screen.getByRole("button", { name: "b" }));
    expect(onOpenFolder).toHaveBeenCalledWith("a/b");
  });
});
