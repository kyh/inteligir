// ⌘P's "Save link…": the field is the address. A link the library already holds offers itself
// instead of a second copy, by the index's url key, so a tracking parameter or a `www.` never
// makes a duplicate.

import { CommandEmpty, CommandGroup, CommandItem } from "@repo/ui/components/command";
import { isWebUrl } from "@repo/notes/items/item-url";
import { WEB_URL_RULE } from "@repo/notes/items/item-kind";
import { useQuery } from "@tanstack/react-query";
import { BookmarkCheckIcon, BookmarkPlusIcon } from "lucide-react";

import { orpc } from "../api";
import { PalettePage, SEARCH_DEBOUNCE_MS, useDebounced } from "./palette-page";

export interface SaveLinkPageProps {
  open: boolean;
  query: string;
  onSave: (url: string) => void;
  onOpenItem: (path: string) => void;
}

export const SaveLinkPage = ({ open, query, onSave, onOpenItem }: SaveLinkPageProps) => {
  const url = query.trim();
  const settled = useDebounced(url, SEARCH_DEBOUNCE_MS);
  const web = isWebUrl(url);
  const lookup = useQuery({
    ...orpc.knowledge.findByUrl.queryOptions({ input: { url: settled } }),
    enabled: open && isWebUrl(settled),
    retry: false,
  });
  const existing = settled === url ? (lookup.data?.items[0] ?? null) : null;
  return (
    <PalettePage>
      <CommandEmpty>{url === "" ? "Type or paste a link." : WEB_URL_RULE}</CommandEmpty>
      {web ? (
        <CommandGroup heading="Link">
          {existing === null ? (
            <CommandItem
              action={`Save ${url}`}
              onSelect={() => {
                onSave(url);
              }}
            >
              <BookmarkPlusIcon />
              <span className="truncate">Save {url}</span>
            </CommandItem>
          ) : (
            <CommandItem
              action={`Already saved: ${existing.title}`}
              onSelect={() => {
                onOpenItem(existing.path);
              }}
            >
              <BookmarkCheckIcon />
              <span className="truncate">Already saved: {existing.title}</span>
            </CommandItem>
          )}
        </CommandGroup>
      ) : null}
    </PalettePage>
  );
};
