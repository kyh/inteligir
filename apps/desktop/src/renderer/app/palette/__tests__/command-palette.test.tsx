// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Thread } from "@repo/contract/local/threads/threads-schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hotkeyCaps } from "@repo/ui/lib/hotkey-spelling";
import { GLOBAL_SHORTCUTS, globalShortcutHotkey } from "../../global-shortcuts";
import type { CommandPalette } from "../command-palette";
import {
  defaultRequest,
  makeActions,
  renderWithQueries,
  stubPaletteFetch,
} from "./palette-harness";
import type { PaletteFakes } from "./palette-harness";

type PaletteProps = React.ComponentProps<typeof CommandPalette>;

type RenderOverrides = Partial<PaletteProps> & { fakes?: PaletteFakes };

const renderPalette = ({ fakes, ...overrides }: RenderOverrides = {}) => {
  stubPaletteFetch(fakes ?? {});
  const actions = makeActions();
  const onOpenChange = vi.fn<PaletteProps["onOpenChange"]>();
  const props: PaletteProps = {
    actions,
    canSync: false,
    modifier: "meta",
    onOpenChange,
    open: true,
    request: defaultRequest,
    threads: [],
    ...overrides,
  };
  const { queryClient, rerender } = renderWithQueries(props);
  return { actions, onOpenChange, props, queryClient, rerender };
};

// The footer names the row Enter would run, so a row's label is on screen twice. Every row
// assertion scopes itself to the list.
const rows = () => within(screen.getByRole("listbox"));

// A chord draws one box per key, so it is read off the row's own caps rather than as one string.
const chords = (): string[][] =>
  [...screen.getByRole("listbox").querySelectorAll("[data-slot='command-shortcut']")].map((kbd) =>
    [...kbd.children].map((cap) => cap.textContent ?? ""),
  );

const searchBox = (): HTMLElement => screen.getByPlaceholderText("Search commands…");

beforeEach(() => {
  stubPaletteFetch({});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("commands", () => {
  it("asks the agent", () => {
    const { actions } = renderPalette();
    fireEvent.click(rows().getByText("Ask the agent"));
    expect(actions.askAgent).toHaveBeenCalled();
  });

  it("filters commands by the query", () => {
    renderPalette();
    fireEvent.change(searchBox(), { target: { value: "short" } });
    expect(rows().getByText("Keyboard shortcuts")).toBeDefined();
    expect(rows().queryByText("Settings")).toBeNull();
  });

  it("hides Sync now while signed out and shows it signed in", () => {
    renderPalette();
    expect(rows().queryByText("Sync now")).toBeNull();
    cleanup();
    const { actions } = renderPalette({ canSync: true });
    fireEvent.click(rows().getByText("Sync now"));
    expect(actions.syncNow).toHaveBeenCalled();
  });

  it("opens settings", () => {
    const { actions } = renderPalette();
    fireEvent.click(rows().getByText("Settings"));
    expect(actions.openSettings).toHaveBeenCalled();
  });
});

const ACTION: Thread = {
  activeTurnId: null,
  archivedAt: null,
  createdAt: 1,
  id: "thr_1",
  originDocPath: null,
  providerId: null,
  runsElsewhere: false,
  status: "idle",
  title: "Tidy the intro",
  updatedAt: 1,
};

describe("the actions page", () => {
  it("opens the picked action", () => {
    const { actions } = renderPalette({ threads: [ACTION] });
    fireEvent.click(rows().getByText("Actions"));
    fireEvent.click(rows().getByText("Tidy the intro"));
    expect(actions.openThread).toHaveBeenCalledWith("thr_1");
  });

  it("says there are none only for an empty field over no loaded actions", async () => {
    renderPalette();
    fireEvent.click(rows().getByText("Actions"));
    expect(rows().getByText("No actions yet.")).toBeDefined();
    cleanup();
    renderPalette({ threads: [ACTION] });
    fireEvent.click(rows().getByText("Actions"));
    fireEvent.change(screen.getByPlaceholderText("Find an action…"), {
      target: { value: "nowhere" },
    });
    expect(await rows().findByText("No action matches.")).toBeDefined();
    expect(rows().queryByText("No actions yet.")).toBeNull();
  });

  it("asks the server for typed text, so an action past the loaded pages is found", async () => {
    const older: Thread = { ...ACTION, id: "thr_old", title: "Draft the budget" };
    const asked: string[] = [];
    const { actions } = renderPalette({
      fakes: {
        threads: (request) => {
          asked.push(request.query);
          return { nextCursor: null, threads: [older] };
        },
      },
      threads: [ACTION],
    });
    fireEvent.click(rows().getByText("Actions"));
    fireEvent.change(screen.getByPlaceholderText("Find an action…"), {
      target: { value: " budget " },
    });
    fireEvent.click(await rows().findByText("Draft the budget"));
    expect(asked).toEqual(["budget"]);
    expect(actions.openThread).toHaveBeenCalledWith("thr_old");
  });
});

describe("a page switch", () => {
  it("keeps the one dialog and its field, with the caret still in it", async () => {
    renderPalette();
    const dialog = screen.getByRole("dialog");
    const field = screen.getByRole("combobox");
    await waitFor(() => {
      expect(document.activeElement).toBe(field);
    });
    fireEvent.click(rows().getByText("Keyboard shortcuts"));
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(screen.getByPlaceholderText("Filter shortcuts…")).toBe(field);
    expect(document.activeElement).toBe(field);
  });
});

describe("the keyboard shortcuts page", () => {
  it("lists every row of the table, spelled for the keyboard the palette was given", () => {
    renderPalette();
    fireEvent.click(rows().getByText("Keyboard shortcuts"));
    expect(screen.getByPlaceholderText("Filter shortcuts…")).toBeDefined();
    for (const row of GLOBAL_SHORTCUTS) {
      expect(rows().getByText(row.label)).toBeDefined();
      expect(chords()).toContainEqual(hotkeyCaps(globalShortcutHotkey(row), "meta"));
    }
  });

  it("filters by label or chord", () => {
    renderPalette();
    fireEvent.click(rows().getByText("Keyboard shortcuts"));
    fireEvent.change(screen.getByPlaceholderText("Filter shortcuts…"), {
      target: { value: "⌘," },
    });
    expect(rows().getByText("Settings")).toBeDefined();
    expect(rows().queryByText("Ask the agent")).toBeNull();
  });
});

describe("a command's binding", () => {
  it("is the global table's row, not a literal", () => {
    renderPalette();
    expect(chords()).toContainEqual(["⌘", "K"]);
    expect(chords()).toContainEqual(["⌘", ","]);
    cleanup();
    renderPalette({ modifier: "ctrl" });
    expect(chords()).toContainEqual(["Ctrl", "K"]);
    expect(chords()).toContainEqual(["Ctrl", ","]);
  });
});
