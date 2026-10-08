// The params a screen reads, spelled once. Outside src/app, so expo-router makes no route of it.

// a param the router was handed twice arrives as an array; a screen reads the first
export const firstParam = (value: string | string[] | undefined): string | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;

// the thread view's params: a thread this phone opened to start carries `start`, so its empty
// view asks for a first request rather than waiting on a sync
export interface ThreadParams {
  [param: string]: string | undefined;
  id: string;
  start?: "1";
}

export const startsHere = (value: string | string[] | undefined): boolean =>
  firstParam(value) === "1";
