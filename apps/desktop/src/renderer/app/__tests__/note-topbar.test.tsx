// @vitest-environment jsdom

import { SidebarProvider } from "@repo/ui/components/sidebar";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NoteTopbar } from "../note-topbar";
import { initialUpdateState } from "../../../update-state";

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
        onFindInNote={vi.fn()}
        onOpenFolder={vi.fn()}
        insetTitleBar={false}
        commentCount={0}
        onOpenComments={vi.fn()}
        onExportPdf={vi.fn()}
      />
    </SidebarProvider>,
  );
  fireEvent.click(screen.getByLabelText("Copy link"));
  return copied[0];
}

const inert = initialUpdateState("0.0.0", "a test stub");
const inertVaults = {
  current: { path: "/home/me/Inteligir", name: "Inteligir" },
  recent: [],
  blocked: null,
};

const inertSpellcheck = {
  enabled: true,
  languages: [],
  available: [],
  languagesConfigurable: false,
};

describe("copy link", () => {
  it("names the loopback server, not the shell's own scheme", () => {
    window.desktopBridge = {
      socketOrigin: "http://127.0.0.1:26723",
      updates: {
        getState: () => Promise.resolve(inert),
        check: () => Promise.resolve(inert),
        download: () => Promise.resolve(inert),
        install: () => Promise.resolve(inert),
        onState: () => () => {},
      },
      spellcheck: {
        getState: () => Promise.resolve(inertSpellcheck),
        apply: () => Promise.resolve(inertSpellcheck),
      },
      paths: {
        reveal: () => Promise.resolve({ ok: true }),
        open: () => Promise.resolve({ ok: true }),
      },
      vaults: {
        getState: () => Promise.resolve(inertVaults),
        pick: () => Promise.resolve(inertVaults),
        open: () => Promise.resolve(inertVaults),
        forget: () => Promise.resolve(inertVaults),
      },
    };
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
          onFindInNote={vi.fn()}
          onOpenFolder={vi.fn()}
          insetTitleBar={false}
          commentCount={0}
          onOpenComments={vi.fn()}
          onExportPdf={vi.fn()}
        />
      </SidebarProvider>,
    );
    expect(screen.getByText("Notes")).toBeDefined();
  });
});

describe("the folder breadcrumb", () => {
  it("names each folder on the way and scopes the rail to the one clicked", () => {
    const onOpenFolder = vi.fn();
    render(
      <SidebarProvider>
        <NoteTopbar
          path="a/b/c.md"
          railOpen
          onToggleRail={vi.fn()}
          canBack={false}
          canForward={false}
          onBack={vi.fn()}
          onForward={vi.fn()}
          onFindInNote={vi.fn()}
          onOpenFolder={onOpenFolder}
          insetTitleBar={false}
          commentCount={0}
          onOpenComments={vi.fn()}
          onExportPdf={vi.fn()}
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
