import { router } from "expo-router";

export const firstParam = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? null;

export const FOCUS = "1";

export const openItem = (itemId: string, options: { readonly focus?: boolean } = {}) => {
  router.push({
    params: options.focus === true ? { focus: FOCUS, id: itemId } : { id: itemId },
    pathname: "/item/[id]",
  });
};

export const openViewer = (itemId: string) => {
  router.push({ params: { id: itemId }, pathname: "/view/[id]" });
};

export const NEW_THREAD = "new";

export const openAgent = (threadId?: string, fromItem?: string) => {
  const id = threadId ?? NEW_THREAD;
  router.push({
    params: fromItem === undefined ? { thread: id } : { item: fromItem, thread: id },
    pathname: "/agent/[thread]",
  });
};

export const openConversations = () => {
  router.push({ pathname: "/agent" });
};
