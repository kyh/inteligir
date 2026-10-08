// The params a screen reads, spelled once. Outside src/app, so expo-router makes no route of it.

// a param the router was handed twice arrives as an array; a screen reads the first
export const firstParam = (value: string | string[] | undefined): string | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;
