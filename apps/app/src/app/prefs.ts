// UI preferences live in localStorage — per machine, per browser profile, no
// server persistence yet (deliberate: the server's config surface is the
// vault, not chrome state). Every reader tolerates a missing or broken store.

import { parseTheme, type Theme } from "@repo/ui/lib/theme";

const KEYS = {
  sidebarWidth: "inteligir.sidebar-width",
  lastOpenNote: "inteligir.last-open-note",
  theme: "inteligir.theme",
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
export const SIDEBAR_WIDTH_MIN = 180;
export const SIDEBAR_WIDTH_MAX = 480;

export function readSidebarWidth(): number {
  const raw = read(KEYS.sidebarWidth);
  const parsed = raw === null ? Number.NaN : Number(raw);
  if (!Number.isFinite(parsed)) {
    return SIDEBAR_WIDTH_DEFAULT;
  }
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(parsed)));
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

export function readTheme(): Theme {
  return parseTheme(read(KEYS.theme)) ?? "system";
}

export function writeTheme(theme: Theme): void {
  write(KEYS.theme, theme);
}
