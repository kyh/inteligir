// The item an editor shows, by its id, for what is drawn inside it: a highlight's tint and note
// keyed by the item's entries, a heading's fold, an embed of the item itself refused. The item
// editor provides it around its surface; a node outside one reads null.

import { createContext, useContext } from "react";
import type { ReactNode } from "react";

const OpenItemContext = createContext<string | null>(null);

export const OpenItemProvider = ({
  itemId,
  children,
}: {
  itemId: string | null;
  children: ReactNode;
}) => <OpenItemContext value={itemId}>{children}</OpenItemContext>;

export const useOpenItemId = (): string | null => useContext(OpenItemContext);
