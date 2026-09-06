import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "@repo/ui/components/sidebar";
import { z } from "zod";
import { parseTheme, type Theme } from "@repo/ui/lib/theme";
import { spellcheckChoiceSchema, type SpellcheckChoice } from "../../spellcheck-state";
import { APPEARANCE_DEFAULTS, appearanceSchema, type Appearance } from "./appearance";

const KEYS = {
  sidebarWidth: "inteligir.sidebar-width",
  lastOpenNote: "inteligir.last-open-note",
  panelOpen: "inteligir.panel-open",
  theme: "inteligir.theme",
  appearance: "inteligir.appearance",
  relatedOpen: "inteligir.related-open",
  railSections: "inteligir.rail-sections",
  sidebarFolder: "inteligir.sidebar-folder",
  treeSort: "inteligir.tree-sort",
  spellcheck: "inteligir.spellcheck",
};

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // A full or blocked store loses a preference, nothing more.
  }
}

const SIDEBAR_WIDTH_DEFAULT = 260;

// Clamped with the rail's own bounds, or a stored width the rail cannot
// produce comes back on reload.
export function readSidebarWidth(): number {
  const raw = read(KEYS.sidebarWidth);
  const parsed = raw === null ? Number.NaN : Number(raw);
  if (!Number.isFinite(parsed)) {
    return SIDEBAR_WIDTH_DEFAULT;
  }
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(parsed)));
}

export function writeSidebarWidth(px: number): void {
  write(KEYS.sidebarWidth, String(Math.round(px)));
}

export function readLastOpenNote(): string | null {
  return read(KEYS.lastOpenNote);
}

export function writeLastOpenNote(path: string | null): void {
  write(KEYS.lastOpenNote, path);
}

export function readPanelOpen(): boolean {
  return read(KEYS.panelOpen) !== "false";
}

export function writePanelOpen(open: boolean): void {
  write(KEYS.panelOpen, open ? "true" : "false");
}

export function readRelatedOpen(): boolean {
  return read(KEYS.relatedOpen) !== "false";
}

export function writeRelatedOpen(open: boolean): void {
  write(KEYS.relatedOpen, open ? "true" : "false");
}

export type RailSection = "recent" | "files" | "tags";
const railSectionsSchema = z.object({ recent: z.boolean(), files: z.boolean(), tags: z.boolean() });
export type RailSections = z.infer<typeof railSectionsSchema>;
const RAIL_SECTIONS_DEFAULT: RailSections = { recent: true, files: true, tags: false };

// which of the rail's stacked sections are unfolded
export function readRailSections(): RailSections {
  const raw = read(KEYS.railSections);
  if (raw === null) {
    return RAIL_SECTIONS_DEFAULT;
  }
  try {
    return railSectionsSchema.parse(JSON.parse(raw));
  } catch {
    return RAIL_SECTIONS_DEFAULT;
  }
}

export function writeRailSections(sections: RailSections): void {
  write(KEYS.railSections, JSON.stringify(sections));
}

// "" is the vault root. A remembered folder the vault no longer holds is the rail's to fall back from.
export function readSidebarFolder(): string {
  return read(KEYS.sidebarFolder) ?? "";
}

export function writeSidebarFolder(folder: string): void {
  write(KEYS.sidebarFolder, folder === "" ? null : folder);
}

export type TreeSort = "name" | "modified";

export function readTreeSort(): TreeSort {
  return read(KEYS.treeSort) === "modified" ? "modified" : "name";
}

export function writeTreeSort(sort: TreeSort): void {
  write(KEYS.treeSort, sort);
}

export function readTheme(): Theme {
  return parseTheme(read(KEYS.theme)) ?? "system";
}

export function writeTheme(theme: Theme): void {
  write(KEYS.theme, theme);
}

// null: never chosen, so the session keeps whatever it has
export function readSpellcheck(): SpellcheckChoice | null {
  const raw = read(KEYS.spellcheck);
  if (raw === null) {
    return null;
  }
  try {
    return spellcheckChoiceSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeSpellcheck(choice: SpellcheckChoice): void {
  write(KEYS.spellcheck, JSON.stringify(choice));
}

export function readAppearance(): Appearance {
  const raw = read(KEYS.appearance);
  if (raw === null) {
    return APPEARANCE_DEFAULTS;
  }
  try {
    return appearanceSchema.parse(JSON.parse(raw));
  } catch {
    return APPEARANCE_DEFAULTS;
  }
}

export function writeAppearance(appearance: Appearance): void {
  write(KEYS.appearance, JSON.stringify(appearance));
}
