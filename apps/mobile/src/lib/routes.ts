// The stack's pushes and the params they carry, spelled once for every screen that opens an item,
// a file or a conversation. Outside src/app, so expo-router makes no route of it.

import { router } from "expo-router";

// a param the router was handed twice arrives as an array; a screen reads the first
export const firstParam = (value: string | string[] | undefined): string | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;

// the param an item opened to be written in carries
export const FOCUS = "1";

// an item in its note page, by its id; `focus`: the caret at the end of its body, the keyboard up
export const openItem = (itemId: string, options: { readonly focus?: boolean } = {}): void => {
  router.push({
    params: options.focus === true ? { focus: FOCUS, id: itemId } : { id: itemId },
    pathname: "/item/[id]",
  });
};

// an item's file full size: a picture, a PDF, a file
export const openViewer = (itemId: string): void => {
  router.push({ params: { id: itemId }, pathname: "/view/[id]" });
};

// the route a conversation not yet begun is opened at
export const NEW_THREAD = "new";

// the built-in agent: a conversation by its id, or a new one, asked from an item when one is named
export const openAgent = (threadId?: string, fromItem?: string): void => {
  const id = threadId ?? NEW_THREAD;
  router.push({
    params: fromItem === undefined ? { thread: id } : { item: fromItem, thread: id },
    pathname: "/agent/[thread]",
  });
};

// the built-in agent's conversations
export const openConversations = (): void => {
  router.push({ pathname: "/agent" });
};
