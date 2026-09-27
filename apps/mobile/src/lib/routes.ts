// The stack's pushes and the params they carry, spelled once for every screen that opens a note or a
// thread. Outside src/app, so expo-router makes no route of it.

import { router } from "expo-router";

// a param the router was handed twice arrives as an array; a screen reads the first
export const firstParam = (value: string | string[] | undefined): string | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;

// the router takes params as an open record, so these say they are one
export interface ThreadParams {
  [param: string]: string | undefined;
  id: string;
  note: string;
  quote?: string;
  revision?: string;
}

export const openNote = (path: string, focus?: "title" | "body"): void => {
  const segments = path.split("/");
  router.push({
    params: focus === undefined ? { path: segments } : { focus, path: segments },
    pathname: "/notes/[...path]",
  });
};

export const openThread = (params: ThreadParams): void => {
  router.push({ params, pathname: "/thread/[id]" });
};
