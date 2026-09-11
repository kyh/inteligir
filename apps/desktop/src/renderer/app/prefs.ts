import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "@repo/ui/components/sidebar";
import { parseTheme } from "@repo/ui/lib/theme";
import type { Theme } from "@repo/ui/lib/theme";
import { spellcheckChoiceSchema } from "../../spellcheck-state";
import type { SpellcheckChoice } from "../../spellcheck-state";
import { APPEARANCE_DEFAULTS, appearanceSchema } from "./appearance-options";
import type { Appearance } from "./appearance-options";

const KEYS = {
  appearance: "inteligir.appearance",
  lastOpenNote: "inteligir.last-open-note",
  panelOpen: "inteligir.panel-open",
  panelWidth: "inteligir.panel-width",
  railView: "inteligir.rail-view",
  relatedOpen: "inteligir.related-open",
  sidebarFolder: "inteligir.sidebar-folder",
  sidebarWidth: "inteligir.sidebar-width",
  spellcheck: "inteligir.spellcheck",
  theme: "inteligir.theme",
  treeSort: "inteligir.tree-sort",
};

const read = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string, value: string | null): void => {
  try {
    if (value === null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // A full or blocked store loses a preference, nothing more.
  }
};

const SIDEBAR_WIDTH_DEFAULT = 260;
const PANEL_WIDTH_DEFAULT = 320;

// Clamped with the rail's own bounds, or a stored width the rail cannot
// produce comes back on reload.
const readWidth = (key: string, fallback: number): number => {
  const raw = read(key);
  const parsed = raw === null ? Number.NaN : Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(parsed)));
};

export const readSidebarWidth = (): number => readWidth(KEYS.sidebarWidth, SIDEBAR_WIDTH_DEFAULT);

export const writeSidebarWidth = (px: number): void => {
  write(KEYS.sidebarWidth, String(Math.round(px)));
};

// the right panel is the same primitive as the rail, dragged by the same handle
export const readPanelWidth = (): number => readWidth(KEYS.panelWidth, PANEL_WIDTH_DEFAULT);

export const writePanelWidth = (px: number): void => {
  write(KEYS.panelWidth, String(Math.round(px)));
};

export const readLastOpenNote = (): string | null => read(KEYS.lastOpenNote);

export const writeLastOpenNote = (path: string | null): void => {
  write(KEYS.lastOpenNote, path);
};

// closed until asked for: a comment focus or the top bar's Comments opens it
export const readPanelOpen = (): boolean => read(KEYS.panelOpen) === "true";

export const writePanelOpen = (open: boolean): void => {
  write(KEYS.panelOpen, open ? "true" : "false");
};

export const readRelatedOpen = (): boolean => read(KEYS.relatedOpen) !== "false";

export const writeRelatedOpen = (open: boolean): void => {
  write(KEYS.relatedOpen, open ? "true" : "false");
};

export const RAIL_VIEWS = ["recent", "files"] as const;
export type RailView = (typeof RAIL_VIEWS)[number];

// which of the rail's views is showing
export const readRailView = (): RailView => {
  const raw = read(KEYS.railView);
  return RAIL_VIEWS.find((view) => view === raw) ?? "files";
};

export const writeRailView = (view: RailView): void => {
  write(KEYS.railView, view);
};

// "" is the vault root. A remembered folder the vault no longer holds is the rail's to fall back from.
export const readSidebarFolder = (): string => read(KEYS.sidebarFolder) ?? "";

export const writeSidebarFolder = (folder: string): void => {
  write(KEYS.sidebarFolder, folder === "" ? null : folder);
};

export type TreeSort = "name" | "modified";

export const readTreeSort = (): TreeSort =>
  read(KEYS.treeSort) === "modified" ? "modified" : "name";

export const writeTreeSort = (sort: TreeSort): void => {
  write(KEYS.treeSort, sort);
};

export const readTheme = (): Theme => parseTheme(read(KEYS.theme)) ?? "system";

export const writeTheme = (theme: Theme): void => {
  write(KEYS.theme, theme);
};

// null: never chosen, so the session keeps whatever it has
export const readSpellcheck = (): SpellcheckChoice | null => {
  const raw = read(KEYS.spellcheck);
  if (raw === null) {
    return null;
  }
  try {
    return spellcheckChoiceSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
};

export const writeSpellcheck = (choice: SpellcheckChoice): void => {
  write(KEYS.spellcheck, JSON.stringify(choice));
};

export const readAppearance = (): Appearance => {
  const raw = read(KEYS.appearance);
  if (raw === null) {
    return APPEARANCE_DEFAULTS;
  }
  try {
    return appearanceSchema.parse(JSON.parse(raw));
  } catch {
    return APPEARANCE_DEFAULTS;
  }
};

export const writeAppearance = (appearance: Appearance): void => {
  write(KEYS.appearance, JSON.stringify(appearance));
};
