import { ItemEditor } from "@repo/editor/item/item-editor";
import type { OpenNote } from "@repo/editor/item/item-editor";
import { jumpToFindMatch, setFindBarAnchor } from "@repo/editor/find-bar";
import { onLiveEditor } from "@repo/editor/live-editor";
import { shownTitle, UNTITLED } from "@repo/contract/items/item-name";
import { Button } from "@repo/ui/components/button";
import { cn } from "@repo/ui/lib/cn";
import { platformShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { isImeComposing } from "@repo/ui/lib/ime";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft as ArrowLeftIcon, LayoutRight as PanelRightIcon } from "@untitledui/icons";
import { useEffect, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { useLibraryQueries, useLibraryWrites, usePageLibrary } from "../cloud/library-context";
import { useLibraryCommands } from "../library/library-commands";
import { libraryGoes, useLibraryAddress } from "../library-history";
import { shortcutFor } from "../shortcuts";
import { TopBar } from "../top-bar";
import { FilePane, FileStage, ReadingNotice, SourceHeader } from "./item-stages";
import { useAgentHolds } from "./use-agent-holds";

export interface ItemViewProps {
  readonly itemId: string;
  readonly onNote: (note: OpenNote | null) => void;
}

const TitleField = ({
  itemId,
  title,
  placeholder,
}: {
  itemId: string;
  title: string;
  placeholder: string;
}) => {
  const retitle = useMutation(useLibraryWrites().organize("The title couldn't be changed."));
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
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
      placeholder={placeholder}
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

const FindBarAnchor = () => <div ref={setFindBarAnchor} className="relative" />;

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
  const { find } = useLibraryAddress();
  const [note, setNote] = useState<OpenNote | null>(null);
  useAgentHolds(note);

  useEffect(() => {
    if (find === null) {
      return;
    }

    return onLiveEditor(itemId, (editor) => {
      jumpToFindMatch(editor, find, 0);
      libraryGoes.dropFind();
    });
  }, [find, itemId]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (shortcutFor(event.nativeEvent, "item", modifier)?.action === "back-to-library") {
      event.preventDefault();
      commands.closeItem();
    }
  };

  const held = item.data ?? null;

  const split =
    held !== null &&
    held.fields.originalSha !== null &&
    held.fields.kind === "image" &&
    held.card.words > 0;

  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- the view's own Escape, which every control inside it hands up unless it holds the key itself
    <div className="flex h-full min-h-0 flex-col" data-item-id={itemId} onKeyDown={onKeyDown}>
      <TopBar className="px-3">
        <Button
          variant="ghost"
          size="icon"
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
          <TitleField
            key={itemId}
            itemId={itemId}
            title={held.fields.title}
            placeholder={held.fields.url === null ? UNTITLED : held.card.title}
          />
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label="Info and the agent"
          onClick={() => {
            workspace.togglePanel();
          }}
        >
          <PanelRightIcon />
        </Button>
      </TopBar>
      <FindBarAnchor />
      <div className={cn("flex min-h-0 flex-1 flex-col", split && "lg:flex-row")}>
        {held !== null && split ? (
          <FilePane fields={held.fields} title={shownTitle(held.card.title)} />
        ) : null}
        <EditorScroller>
          {held === null ? null : (
            <>
              <SourceHeader fields={held.fields} />
              <ReadingNotice fields={held.fields} />
              {split ? (
                <p className="m-0 px-8 pt-4 text-caption text-muted-foreground">
                  The words read from this picture. Fix anything it misread right here.
                </p>
              ) : (
                <FileStage
                  fields={held.fields}
                  itemId={itemId}
                  title={shownTitle(held.card.title)}
                />
              )}
              {held.fields.kind === "pdf" && held.fields.originalSha !== null ? (
                <p className="m-0 px-8 pt-4 text-caption text-muted-foreground">
                  The text read from this PDF, which search and the agent read. Saving an edit reads
                  it again.
                </p>
              ) : null}
            </>
          )}
          <ItemEditor
            itemId={itemId}
            onNote={(opened) => {
              setNote(opened);
              onNote(opened);
            }}
          />
        </EditorScroller>
      </div>
    </div>
  );
};
