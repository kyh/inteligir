// @vitest-environment jsdom

// "Copy link" has to name an address something can OPEN. Under the shell the
// page is served from `inteligir://app` — a scheme no OS registers and this
// process's own window-open policy refuses — so a link built from the page's
// origin resolves nowhere, inteligir itself included.

import { SidebarProvider } from "@repo/ui/components/sidebar";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NoteTopbar } from "../note-topbar";

afterEach(() => {
  cleanup();
  delete window.desktopBridge;
  vi.restoreAllMocks();
});

function copiedAfterClick(): string | undefined {
  const copied: string[] = [];
  vi.stubGlobal("navigator", {
    clipboard: {
      writeText: (text: string) => {
        copied.push(text);
        return Promise.resolve();
      },
    },
  });
  render(
    <SidebarProvider>
      <NoteTopbar
        path="Plans/Weekly Plan.md"
        railOpen
        onToggleRail={vi.fn()}
        canBack={false}
        canForward={false}
        onBack={vi.fn()}
        onForward={vi.fn()}
        onOpenSearch={vi.fn()}
        commentCount={0}
        onOpenComments={vi.fn()}
        onExportPdf={vi.fn()}
      />
    </SidebarProvider>,
  );
  fireEvent.click(screen.getByLabelText("Copy link"));
  return copied[0];
}

describe("copy link", () => {
  it("names the loopback server, not the shell's own scheme", () => {
    window.desktopBridge = { socketOrigin: "http://127.0.0.1:26723" };
    expect(copiedAfterClick()).toBe("http://127.0.0.1:26723/?note=Plans%2FWeekly+Plan.md");
  });

  it("falls back to the page's origin in a plain browser tab", () => {
    expect(copiedAfterClick()).toBe(`${window.location.origin}/?note=Plans%2FWeekly+Plan.md`);
  });
});

describe("the note's name in the bar", () => {
  it("hides the extension the domain hides, whatever its case", () => {
    render(
      <SidebarProvider>
        <NoteTopbar
          path="Notes.MD"
          railOpen
          onToggleRail={vi.fn()}
          canBack={false}
          canForward={false}
          onBack={vi.fn()}
          onForward={vi.fn()}
          onOpenSearch={vi.fn()}
          commentCount={0}
          onOpenComments={vi.fn()}
          onExportPdf={vi.fn()}
        />
      </SidebarProvider>,
    );
    expect(screen.getByText("Notes")).toBeDefined();
  });
});
