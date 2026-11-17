// CLAUDE.md § The library is home, and an item is shown by its kind. An item opens full size in the
// grid's place: a file's viewer above it, a saved page's source, and the item's own blocks in the
// editor (`@repo/editor/item/item-editor`) over its note's live document, which every device and
// the agent edit at once. The header reads the item's row, read again as its card moves. Escape
// outside the editor goes back to the library.

import { ItemEditor } from "@repo/editor/item/item-editor";
import type { OpenNote } from "@repo/editor/item/item-editor";
import { jumpToFindMatch, setFindBarAnchor } from "@repo/editor/find-bar";
import { onLiveEditor } from "@repo/editor/live-editor";
import { shownTitle, UNTITLED } from "@repo/contract/items/item-name";
import { Button } from "@repo/ui/components/button";
import { platformShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { isImeComposing } from "@repo/ui/lib/ime";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon, PanelRightIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { useLibraryQueries, useLibraryWrites, usePageLibrary } from "../cloud/library-context";
import { useLibraryCommands } from "../library/library-commands";
import { shortcutFor } from "../shortcuts";
import { TopBar } from "../top-bar";
import { FileStage, ReadingNotice, SourceHeader } from "./item-stages";

const libraryRoute = getRouteApi("/library");

export interface ItemViewProps {
  readonly itemId: string;
  readonly onNote: (note: OpenNote | null) => void;
}

const TitleField = ({ itemId, title }: { itemId: string; title: string }) => {
  const retitle = useMutation(useLibraryWrites().organize("The title couldn't be changed."));
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (): void => {
    const next = (draft ?? title).trim();
    setDraft(null);
    if (next !== "" && next !== title) {
      retitle.mutate({ ids: [itemId], title: next });
    }
  };
  return (
    <input
      aria-label="Title"
      spellCheck={false}
      className="min-w-0 flex-1 truncate bg-transparent text-title font-medium outline-none"
      value={draft ?? title}
      placeholder={UNTITLED}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (isImeComposing(event)) {
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
      }}
    />
  );
};

// where the editor's find bar (⌘F) draws, over the item's text
const FindBarAnchor = () => <div ref={setFindBarAnchor} className="relative" />;

// a far jump, the outline and WebKit's missing scroll anchor are kept against this element
// (packages/editor/src/run-anchoring.ts, scroll-reveal.ts, toc.tsx)
const EditorScroller = ({ children }: { children: ReactNode }) => (
  <div className="min-h-0 flex-1 overflow-y-auto" data-editor-scroller="">
    {children}
  </div>
);

export const ItemView = ({ itemId, onNote }: ItemViewProps) => {
  const { workspace } = usePageLibrary();
  const commands = useLibraryCommands();
  const item = useQuery(useLibraryQueries().item(itemId));
  const modifier = platformShortcutModifier();
  const find = libraryRoute.useSearch({ select: (search) => search.find });
  const navigate = useNavigate();

  // the find bar lands on a search's words once the item's editor answers, and the address then
  // drops them
  useEffect(() => {
    if (find === undefined) {
      return;
    }
    return onLiveEditor(itemId, (editor) => {
      jumpToFindMatch(editor, find, 0);
      void navigate({
        replace: true,
        search: (prior) => ({ ...prior, find: undefined }),
        to: ".",
      });
    });
  }, [find, itemId, navigate]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (shortcutFor(event.nativeEvent, "item", modifier)?.action === "back-to-library") {
      event.preventDefault();
      commands.closeItem();
    }
  };

  const held = item.data ?? null;
  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- the view's own Escape, which every control inside it hands up unless it holds the key itself
    <div className="flex h-full min-h-0 flex-col" data-item-id={itemId} onKeyDown={onKeyDown}>
      <TopBar className="px-3">
        <Button
          variant="ghost"
          size="icon-compact"
          aria-label="Back to the library"
          onClick={() => {
            commands.closeItem();
          }}
        >
          <ArrowLeftIcon />
        </Button>
        {held === null ? (
          <span className="flex-1" />
        ) : (
          <TitleField key={itemId} itemId={itemId} title={held.fields.title} />
        )}
        <Button
          variant="ghost"
          size="icon-compact"
          aria-label="Info and the agent"
          onClick={() => {
            workspace.togglePanel();
          }}
        >
          <PanelRightIcon />
        </Button>
      </TopBar>
      <FindBarAnchor />
      <EditorScroller>
        {held === null ? null : (
          <>
            <SourceHeader fields={held.fields} />
            <ReadingNotice fields={held.fields} />
            <FileStage fields={held.fields} title={shownTitle(held.card.title)} />
          </>
        )}
        <ItemEditor itemId={itemId} onNote={onNote} />
      </EditorScroller>
    </div>
  );
};
