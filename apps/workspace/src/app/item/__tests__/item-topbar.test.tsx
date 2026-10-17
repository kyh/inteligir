// @vitest-environment jsdom

import type { LibraryScope } from "@repo/domain/library-scope";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";
import { buildResolver } from "@repo/notes/knowledge/link-resolve";
import { SidebarProvider } from "@repo/ui/components/sidebar-core";
import { toast } from "@repo/ui/components/sonner";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ItemTopbar } from "../item-topbar";
import type { ItemTopbarProps } from "../item-topbar";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mount = (props: Partial<ItemTopbarProps> & { path: string }) =>
  render(
    <SidebarProvider>
      <ItemTopbar
        lead={{
          canBack: false,
          canForward: false,
          onBack: vi.fn<() => void>(),
          onForward: vi.fn<() => void>(),
          onToggleRail: vi.fn<() => void>(),
          railOpen: true,
        }}
        insetTitleBar={false}
        onGoToLibrary={vi.fn<(scope?: LibraryScope) => void>()}
        editable
        url={null}
        face={null}
        onFaceChange={vi.fn<() => void>()}
        onEditAsNote={null}
        onFindInNote={vi.fn<() => void>()}
        annotationCount={0}
        onOpenAnnotations={vi.fn<() => void>()}
        onExportPdf={vi.fn<() => void>()}
        {...props}
      />
    </SidebarProvider>,
  );

// the host's resolver over this listing, as the vault installs it
const copiedAfterClick = async (
  path: string,
  listing: readonly string[],
  item = "Copy link",
  url: string | null = null,
): Promise<string | undefined> => {
  installFakeEditorHost({ resolveWikiTarget: buildResolver(listing).resolveWiki });
  const writeText = vi.fn<Clipboard["writeText"]>().mockResolvedValue();
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  mount({ path, url });
  fireEvent.click(screen.getByLabelText("More"));
  fireEvent.click(await screen.findByRole("menuitem", { name: item }));
  return writeText.mock.calls[0]?.[0];
};

describe("copy link", () => {
  it("copies the item's wiki link by its name when no other item answers to it", async () => {
    expect(await copiedAfterClick("Plans/Weekly Plan.md", ["Plans/Weekly Plan.md", "b.md"])).toBe(
      "[[Weekly Plan]]",
    );
  });

  it("qualifies the link when another item shares the name", async () => {
    expect(
      await copiedAfterClick("Plans/Weekly Plan.md", ["Weekly Plan.md", "Plans/Weekly Plan.md"]),
    ).toBe("[[Plans/Weekly Plan]]");
  });

  it("copies nothing, and says so, for a name no link can carry", async () => {
    const refused = vi.spyOn(toast, "error");
    expect(await copiedAfterClick("Draft [v2].md", ["Draft [v2].md"])).toBeUndefined();
    expect(refused).toHaveBeenCalledOnce();
  });

  it("offers a saved link's address beside it, and copies the address", async () => {
    expect(
      await copiedAfterClick(
        "Unsorted/File over app.md",
        ["Unsorted/File over app.md"],
        "Copy address",
        "https://stephango.com/file-over-app",
      ),
    ).toBe("https://stephango.com/file-over-app");
  });

  it("offers no address for an item that has none", async () => {
    installFakeEditorHost();
    mount({ path: "a.md" });
    fireEvent.click(screen.getByLabelText("More"));
    await screen.findByRole("menuitem", { name: "Copy link" });
    expect(screen.queryByRole("menuitem", { name: "Copy address" })).toBeNull();
  });
});

describe("the item's name in the bar", () => {
  it("hides the extension the domain hides, whatever its case", () => {
    mount({ path: "Notes.MD" });
    expect(screen.getByText("Notes")).toBeDefined();
  });

  it("names a file that is no doc by its own name", () => {
    mount({ path: "assets/IMG_2041.png" });
    expect(screen.getByText("IMG_2041.png")).toBeDefined();
  });
});

describe("the breadcrumb narrows", () => {
  it("goes back to the library, and to each folder's scope, Unsorted its own", () => {
    const onGoToLibrary = vi.fn<(scope?: LibraryScope) => void>();
    mount({ onGoToLibrary, path: "Unsorted/b/c.md" });
    const crumbs = screen.getByRole("navigation", { name: "Item location" });
    expect(crumbs.textContent).toBe("Library›Unsorted›b›c");
    fireEvent.click(screen.getByRole("button", { name: "Back to library" }));
    expect(onGoToLibrary).toHaveBeenLastCalledWith();
    fireEvent.click(screen.getByRole("button", { name: "Unsorted" }));
    expect(onGoToLibrary).toHaveBeenLastCalledWith({ kind: "unsorted" });
    fireEvent.click(screen.getByRole("button", { name: "b" }));
    expect(onGoToLibrary).toHaveBeenLastCalledWith({ kind: "folder", path: "Unsorted/b" });
  });
});

describe("a viewer's bar", () => {
  it("turns off what needs the editor, and offers Edit as note", async () => {
    const onEditAsNote = vi.fn<() => void>();
    mount({ editable: false, onEditAsNote, path: "assets/Lecture.md" });
    expect(screen.getByRole("button", { name: "Find in note" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Annotations" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByLabelText("More"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit as note" }));
    expect(onEditAsNote).toHaveBeenCalledOnce();
  });

  it("switches a saved page between its article and its copy", () => {
    const onFaceChange = vi.fn<(face: "article" | "page-copy") => void>();
    mount({ face: "article", onFaceChange, path: "Unsorted/Page.md" });
    fireEvent.click(screen.getByRole("button", { name: "Page copy" }));
    expect(onFaceChange).toHaveBeenCalledWith("page-copy");
  });
});
