// What a palette page draws under the palette's one field: the list it fills. The dialog, the
// field and the hint strip are the palette's, drawn once, so a page switch swaps only this. Every
// page filters its own rows, so nothing here matches a query.

import { CommandList } from "@repo/ui/components/command";
import { useEffect, useState } from "react";

export const SEARCH_DEBOUNCE_MS = 120;

// the typed text, settled: a query keyed on it fires once per pause, not per keystroke
export const useDebounced = <T,>(value: T, ms: number): T => {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value);
    }, ms);
    return () => {
      clearTimeout(timer);
    };
  }, [value, ms]);
  return settled;
};

export const matchesQuery = (label: string, query: string): boolean =>
  label.toLowerCase().includes(query.trim().toLowerCase());

export const PalettePage = ({ children }: { children: React.ReactNode }) => (
  <CommandList>{children}</CommandList>
);
