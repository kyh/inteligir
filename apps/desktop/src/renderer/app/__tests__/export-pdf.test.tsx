// @vitest-environment jsdom

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  defaultRequest,
  makeActions,
  makeNote,
  renderWithQueries,
  stubPaletteFetch,
} from "../palette/__tests__/palette-harness";
import type { DesktopBridge } from "../../../types";
import { exportNoteAsPdf, installLightPrints } from "../note/export-pdf";
import type { PaletteNote } from "../palette/command-palette";
import { inertBridge } from "./inert-bridge";

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
  vi.restoreAllMocks();
});

// a browser's print: the dialog runs inside the call, between the two events
const printLikeABrowser = (during: () => void) =>
  vi.fn(() => {
    window.dispatchEvent(new Event("beforeprint"));
    during();
    window.dispatchEvent(new Event("afterprint"));
  });

describe("a print", () => {
  it("is light whatever the window shows, and the theme comes back after", () => {
    const uninstall = installLightPrints();
    document.documentElement.classList.add("dark");
    let darkDuringPrint: boolean | null = null;
    printLikeABrowser(() => {
      darkDuringPrint = document.documentElement.classList.contains("dark");
    })();
    uninstall();
    expect(darkDuringPrint).toBe(false);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("leaves a light window light", () => {
    const uninstall = installLightPrints();
    printLikeABrowser(() => {})();
    uninstall();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});

describe("exportNoteAsPdf", () => {
  afterEach(() => {
    delete window.desktopBridge;
  });

  it("prints under the note title in a browser, and restores it", async () => {
    document.title = "inteligir";
    let titleDuringPrint = "";
    const print = printLikeABrowser(() => {
      titleDuringPrint = document.title;
    });
    vi.stubGlobal("print", print);
    await exportNoteAsPdf("Weekly Plan");
    expect(print).toHaveBeenCalledOnce();
    expect(titleDuringPrint).toBe("Weekly Plan");
    expect(document.title).toBe("inteligir");
  });

  it("asks the shell to print, keeping the title until the sheet is done", async () => {
    document.title = "inteligir";
    const print = vi.fn<DesktopBridge["print"]>(async () => ({ ok: true }));
    window.desktopBridge = { ...inertBridge(), print };
    await exportNoteAsPdf("Weekly Plan");
    expect(print).toHaveBeenCalledOnce();
    expect(document.title).toBe("Weekly Plan");
    window.dispatchEvent(new Event("afterprint"));
    expect(document.title).toBe("inteligir");
  });

  it("restores the title at once when the shell will not print", async () => {
    document.title = "inteligir";
    window.desktopBridge = {
      ...inertBridge(),
      print: async () => ({ ok: false, reason: "No window to print." }),
    };
    await exportNoteAsPdf("Weekly Plan");
    expect(document.title).toBe("inteligir");
  });

  it("keeps the current title for an empty note title", async () => {
    document.title = "inteligir";
    let titleDuringPrint = "";
    vi.stubGlobal(
      "print",
      printLikeABrowser(() => {
        titleDuringPrint = document.title;
      }),
    );
    await exportNoteAsPdf("   ");
    expect(titleDuringPrint).toBe("inteligir");
  });
});

const mount = (note: PaletteNote | null) => {
  stubPaletteFetch({});
  return renderWithQueries({
    actions: { ...makeActions(), note },
    canSync: false,
    entries: [],
    onOpenChange: vi.fn<() => void>(),
    open: true,
    request: defaultRequest,
    threads: [],
  });
};

describe("the palette's Export as PDF row", () => {
  it("exists only while a note is open, and runs the export", () => {
    const note = makeNote();
    mount(note);
    screen.getByText("Export as PDF").click();
    expect(note.exportPdf).toHaveBeenCalledOnce();
    cleanup();
    mount(null);
    expect(screen.queryByText("Export as PDF")).toBeNull();
  });
});
