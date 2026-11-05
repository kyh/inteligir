// CLAUDE.md § THE LIBRARY IS HOME, AND AN ITEM IS SHOWN BY ITS KIND. An item opens full size in the
// grid's place: a file's viewer above it, a saved page's source, and the item's own blocks in the
// editor (`@repo/editor/item/item-editor`) over the replica, which writes what changed after a
// pause and lays in what changed elsewhere. Escape outside the editor goes back to the library.

import { ItemEditor } from "@repo/editor/item/item-editor";
import type { ItemSession, ItemSessionPorts } from "@repo/editor/item/item-session";
import { mergeConflictLine } from "@repo/editor/note/vanished-prompt";
import { mergeBlocks } from "@repo/editor/stale-write";
import { setAnnotationMeta } from "@repo/editor/annotations/annotation-store";
import { setFindBarAnchor } from "@repo/editor/find-bar";
import { Button } from "@repo/ui/components/button";
import { toast } from "@repo/ui/components/sonner";
import { Tooltip } from "@repo/ui/components/tooltip";
import { platformShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { isImeComposing } from "@repo/ui/lib/ime";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, PanelRightIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { KeyboardEvent } from "react";

import { useReplica, useReplicaQueries } from "../cloud/library-context";
import { isTextEntryTarget } from "../global-shortcuts";
import { libraryShortcutFor } from "../library/library-keys";
import { retitleItem } from "../library/library-verbs";
import { FileStage, PendingNotice, SourceHeader } from "./item-stages";

const after = (ms: number, run: () => void): (() => void) => {
  const timer = setTimeout(run, ms);
  return () => {
    clearTimeout(timer);
  };
};

export interface ItemViewProps {
  readonly itemId: string;
  readonly onBack: () => void;
  readonly onTogglePanel: () => void;
  readonly onSession: (session: ItemSession | null) => void;
}

const TitleField = ({ itemId, title }: { itemId: string; title: string }) => {
  const replica = useReplica();
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (): void => {
    const next = (draft ?? title).trim();
    setDraft(null);
    if (next !== "" && next !== title) {
      void retitleItem(replica, itemId, next);
    }
  };
  return (
    <input
      aria-label="Title"
      className="min-w-0 flex-1 truncate bg-transparent text-title font-medium outline-none"
      value={draft ?? title}
      placeholder="Untitled"
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

export const ItemView = ({ itemId, onBack, onTogglePanel, onSession }: ItemViewProps) => {
  const replica = useReplica();
  const queries = useReplicaQueries();
  const item = useQuery(queries.item(itemId));
  const annotations = useQuery(queries.annotations(itemId)).data;
  const modifier = platformShortcutModifier();

  // the editor tints a highlight its store holds, and marks the ones that carry a note
  useEffect(() => {
    if (annotations === undefined) {
      return;
    }
    const entries = Object.entries(annotations);
    setAnnotationMeta(itemId, {
      knownIds: new Set(entries.map(([id]) => id)),
      notedIds: new Set(
        entries.flatMap(([id, entry]) =>
          entry.text === "" && !entries.some(([, reply]) => reply.parentId === id) ? [] : [id],
        ),
      ),
    });
  }, [annotations, itemId]);

  // read once as the item opens: the editor holds them for its life
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [ports] = useState<ItemSessionPorts>(() => ({
    after,
    merge: mergeBlocks,
    notifyOverlap: (title) => {
      toast.warning(mergeConflictLine(title));
    },
    store: replica,
  }));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (isTextEntryTarget(event.target)) {
      return;
    }
    if (libraryShortcutFor(event, "item", modifier)?.action === "back-to-library") {
      event.preventDefault();
      onBack();
    }
  };

  const held = item.data ?? null;
  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- the view's own Escape, which every control inside it hands up unless it holds the key itself
    <div className="flex h-full min-h-0 flex-col" data-item-id={itemId} onKeyDown={onKeyDown}>
      <header className="flex h-12 shrink-0 items-center gap-2 px-3">
        <Tooltip content="Back to the library" side="bottom">
          <Button
            variant="ghost"
            size="icon-compact"
            aria-label="Back to the library"
            onClick={onBack}
          >
            <ArrowLeftIcon />
          </Button>
        </Tooltip>
        {held === null ? (
          <span className="flex-1" />
        ) : (
          <TitleField key={held.fields.title} itemId={itemId} title={held.fields.title} />
        )}
        <Tooltip content="Info, highlights, History and the agent" side="bottom">
          <Button
            variant="ghost"
            size="icon-compact"
            aria-label="Info, highlights, History and the agent"
            onClick={onTogglePanel}
          >
            <PanelRightIcon />
          </Button>
        </Tooltip>
      </header>
      {/* where the editor's find bar (⌘F) draws, over the item's text */}
      <div ref={setFindBarAnchor} className="relative" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {held === null ? null : (
          <>
            <SourceHeader fields={held.fields} />
            {held.fields.fetchState === "pending" || held.fields.fetchState === "failed" ? (
              <PendingNotice failed={held.fields.fetchError} />
            ) : null}
            <FileStage fields={held.fields} title={held.card.title} />
          </>
        )}
        <ItemEditor itemId={itemId} ports={ports} onSession={onSession} />
      </div>
    </div>
  );
};
