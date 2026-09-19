// @vitest-environment jsdom

import { SidebarProvider } from "@repo/ui/components/sidebar";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NoteTopbar } from "../note-topbar";
import { inertBridge } from "./inert-bridge";

afterEach(() => {
  cleanup();
  delete window.desktopBridge;
  vi.restoreAllMocks();
});

const copiedAfterClick = async (): Promise<string | undefined> => {
  const writeText = vi.fn<Clipboard["writeText"]>().mockResolvedValue();
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  render(
    <SidebarProvider>
      <NoteTopbar
        path="Plans/Weekly Plan.md"
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
  it("names the loopback server, not the shell's own scheme", async () => {
    window.desktopBridge = { ...inertBridge(), socketOrigin: "http://127.0.0.1:26723" };
    expect(await copiedAfterClick()).toBe("http://127.0.0.1:26723/?note=Plans%2FWeekly+Plan.md");
  });

  it("falls back to the page's origin in a plain browser tab", async () => {
    expect(await copiedAfterClick()).toBe(`${window.location.origin}/?note=Plans%2FWeekly+Plan.md`);
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
