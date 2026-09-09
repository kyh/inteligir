// @vitest-environment jsdom

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  defaultRequest,
  emptySearchSource,
  makeActions,
  renderWithQueries,
  stubKnowledgeFetch,
} from "../palette/__tests__/palette-harness";
import { exportNoteAsPdf } from "../note/export-pdf";

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
  vi.restoreAllMocks();
});

describe("exportNoteAsPdf", () => {
  it("prints under the note title, light, and restores both", () => {
    document.title = "inteligir";
    document.documentElement.classList.add("dark");
    let darkDuringPrint: boolean | null = null;
    let titleDuringPrint = "";
    const print = vi.fn(() => {
      darkDuringPrint = document.documentElement.classList.contains("dark");
      titleDuringPrint = document.title;
    });
    vi.stubGlobal("print", print);

    exportNoteAsPdf("Weekly Plan");

    expect(print).toHaveBeenCalledOnce();
    expect(titleDuringPrint).toBe("Weekly Plan");
    expect(darkDuringPrint).toBe(false);
    expect(document.title).toBe("inteligir");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("restores even when print throws", () => {
    document.title = "inteligir";
    document.documentElement.classList.add("dark");
    vi.stubGlobal(
      "print",
      vi.fn(() => {
        throw new Error("no printer");
      }),
    );

    expect(() => {
      exportNoteAsPdf("Weekly Plan");
    }).toThrow("no printer");
    expect(document.title).toBe("inteligir");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("keeps the current title for an empty note title", () => {
    document.title = "inteligir";
    let titleDuringPrint = "";
    vi.stubGlobal(
      "print",
      vi.fn(() => {
        titleDuringPrint = document.title;
      }),
    );
    exportNoteAsPdf("   ");
    expect(titleDuringPrint).toBe("inteligir");
  });
});

const mount = (exportPdf: (() => void) | null) => {
  stubKnowledgeFetch({});
  return renderWithQueries({
    actions: { ...makeActions(), exportPdf },
    canSync: false,
    entries: [],
    onOpenChange: vi.fn<() => void>(),
    open: true,
    request: defaultRequest,
    searchSource: emptySearchSource,
    threads: [],
  });
};

describe("the palette's Export as PDF row", () => {
  it("exists only while a note is open, and runs the export", () => {
    const exportPdf = vi.fn<() => void>();
    mount(exportPdf);
    screen.getByText("Export as PDF").click();
    expect(exportPdf).toHaveBeenCalledOnce();
    cleanup();
    mount(null);
    expect(screen.queryByText("Export as PDF")).toBeNull();
  });
});
