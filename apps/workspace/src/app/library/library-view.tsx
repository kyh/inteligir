// CLAUDE.md § THE LIBRARY IS HOME. The header, then the kind chips or, while anything is
// selected, the selection's own strip in their place, then the grid. Deleted draws its own cards;
// a scope with nothing in it draws the sentence that says why. The first window's answer gives
// the count and the chips, so the header and the grid agree on one total.

import type { LibraryScope } from "@repo/domain/library-scope";
import type { ItemKind } from "@repo/notes/items/item-kind";
import { UNSORTED_FOLDER } from "@repo/notes/items/item-kind";
import { KNOWLEDGE_ITEM_PATHS_MAX } from "@repo/contract/local/knowledge/knowledge-schema";
import {
  SelectionAction,
  SelectionActions,
  SelectionActionsSeparator,
} from "@repo/ui/ai/selection-actions";
import { FolderInputIcon, MessageSquareIcon, TagIcon, Trash2Icon, XIcon } from "lucide-react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";

import type { TopbarLeadProps } from "../topbar-lead";
import { DeletedItems } from "./deleted-items";
import { formatCount } from "./item-labels";
import type { LibraryItemActions } from "./item-menu";
import { KindChips } from "./kind-chips";
import { LibraryEmpty } from "./library-empty";
import type { LibraryEmptyActions, LibraryEmptyCase } from "./library-empty";
import { LibraryGrid } from "./library-grid";
import { LibraryHeader } from "./library-header";
import type { LibraryAddActions } from "./library-header";
import { materializePaths, useLibraryScopes, useLibraryWindow } from "./library-items";
import type { LibraryFilter, LibrarySort } from "./library-items";
import { selectionCount } from "./library-selection";
import type { LibrarySelectionStore } from "./library-selection";

export interface LibraryViewProps {
  scope: LibraryScope;
  kind: ItemKind | null;
  onKindChange: (kind: ItemKind | null) => void;
  q: string | null;
  onClearQuery: () => void;
  sort: LibrarySort;
  onSortChange: (sort: LibrarySort) => void;
  selection: LibrarySelectionStore;
  // where the grid was scrolled to, kept by the workspace while an item is open over it
  scrollMemory: StoreApi<number>;
  lead: TopbarLeadProps;
  insetTitleBar: boolean;
  add: Omit<LibraryAddActions, "newNote"> & {
    newNote: (folder: string, tags?: readonly string[]) => void;
  };
  onTidy?: (() => void) | undefined;
  onEditFilingRules?: (() => void) | undefined;
  onRenameTag: (tag: string) => void;
  actions: LibraryItemActions;
  onRestored: (path: string) => void;
}

// where "New note" from this scope writes, so the note is in the grid the person comes back to:
// the folder shown; Unsorted from Unsorted, and from a tag tagged with it, as a save from either
// lands; else the library's root
interface NewNoteTarget {
  folder: string;
  tags: string[];
}

const newNoteTarget = (scope: LibraryScope): NewNoteTarget => {
  switch (scope.kind) {
    case "folder": {
      return { folder: scope.path, tags: [] };
    }
    case "unsorted": {
      return { folder: UNSORTED_FOLDER, tags: [] };
    }
    case "tag": {
      return { folder: UNSORTED_FOLDER, tags: [scope.tag] };
    }
    case "all":
    case "deleted": {
      return { folder: "", tags: [] };
    }
    default: {
      const exhaustive: never = scope;
      return exhaustive;
    }
  }
};

// the paths a selection stands for, ⌘A's read from the listing
export const selectionPaths = async (
  selection: LibrarySelectionStore,
  filter: LibraryFilter | null,
): Promise<string[]> => {
  const { all, selected } = selection.store.getState();
  if (all && filter !== null) {
    return await materializePaths(filter, 0, KNOWLEDGE_ITEM_PATHS_MAX);
  }
  return [...selected];
};

const SelectionStrip = ({
  count,
  onTag,
  onMove,
  onAsk,
  onDelete,
  onClear,
}: {
  count: number;
  onTag: () => void;
  onMove: () => void;
  onAsk: () => void;
  onDelete: () => void;
  onClear: () => void;
}) => (
  <div className="flex shrink-0 items-center gap-2 px-4 pt-3">
    <SelectionActions aria-label="Selection">
      <span className="px-2 text-body font-medium text-ink tabular-nums">
        {formatCount(count)} selected
      </span>
      <SelectionActionsSeparator />
      <SelectionAction icon={<TagIcon />} onClick={onTag}>
        Tag…
      </SelectionAction>
      <SelectionAction icon={<FolderInputIcon />} onClick={onMove}>
        Move…
      </SelectionAction>
      <SelectionAction icon={<MessageSquareIcon />} onClick={onAsk}>
        Ask agent
      </SelectionAction>
      <SelectionAction icon={<Trash2Icon />} onClick={onDelete}>
        Delete
      </SelectionAction>
      <SelectionActionsSeparator />
      <SelectionAction icon={<XIcon />} aria-label="Clear the selection" onClick={onClear} />
    </SelectionActions>
  </div>
);

// a new listing is a new grid, scrolled to its top
const filterKey = (filter: LibraryFilter): string => JSON.stringify(filter);

const emptyCase = (filter: LibraryFilter): LibraryEmptyCase => {
  if (filter.q !== null) {
    return { kind: "search", q: filter.q };
  }
  if (filter.kind !== null) {
    return { chip: filter.kind, kind: "chip" };
  }
  return { kind: "scope", scope: filter.scope };
};

export const LibraryView = ({
  scope,
  kind,
  onKindChange,
  q,
  onClearQuery,
  sort,
  onSortChange,
  selection,
  scrollMemory,
  lead,
  insetTitleBar,
  add,
  onTidy,
  onEditFilingRules,
  onRenameTag,
  actions,
  onRestored,
}: LibraryViewProps) => {
  const filter: LibraryFilter | null = scope.kind === "deleted" ? null : { kind, q, scope, sort };
  const head = useLibraryWindow(
    filter ?? { kind: null, q: null, scope: { kind: "all" }, sort },
    0,
    filter !== null,
  );
  const scopes = useLibraryScopes();
  const selected = useStore(selection.store);
  const total = filter === null ? null : (head.data?.total ?? null);
  const count = selectionCount(selected, total ?? 0);
  const noteTarget = newNoteTarget(scope);

  const emptyActions: LibraryEmptyActions = {
    addFiles: add.addFiles,
    clearSearch: onClearQuery,
    importRaindrop: add.importRaindrop,
    newNote: add.newNote,
    retry: () => {
      void head.refetch();
    },
    saveLink: add.saveLink,
    showEverything: () => {
      onKindChange(null);
    },
  };

  const withSelection = (run: (paths: readonly string[]) => void): void => {
    void (async () => {
      const paths = await selectionPaths(selection, filter);
      if (paths.length > 0) {
        run(paths);
      }
    })();
  };

  const tidyShown =
    onTidy !== undefined && (scopes.data?.unsorted ?? 0) + (scopes.data?.untagged ?? 0) > 0;

  const body = () => {
    if (filter === null) {
      return <DeletedItems emptyActions={emptyActions} onRestored={onRestored} />;
    }
    if (head.data === undefined) {
      return (
        <LibraryEmpty
          state={{ kind: head.isError ? "failed" : "loading" }}
          actions={emptyActions}
        />
      );
    }
    if (head.data.total === 0) {
      return <LibraryEmpty state={emptyCase(filter)} actions={emptyActions} />;
    }
    return (
      <LibraryGrid
        key={filterKey(filter)}
        filter={filter}
        total={head.data.total}
        selection={selection}
        scrollMemory={scrollMemory}
        actions={actions}
      />
    );
  };

  // the selection's strip in the chips' place while anything is selected
  const strip = () => {
    if (filter === null) {
      return null;
    }
    if (count > 0) {
      return (
        <SelectionStrip
          count={count}
          onTag={() => {
            withSelection(actions.tag);
          }}
          onMove={() => {
            withSelection(actions.move);
          }}
          onAsk={() => {
            withSelection(actions.askAgent);
          }}
          onDelete={() => {
            withSelection(actions.remove);
          }}
          onClear={() => {
            selection.apply({ kind: "clear" });
          }}
        />
      );
    }
    return (
      <KindChips
        counts={head.data?.kindCounts}
        kind={kind}
        onKindChange={onKindChange}
        q={q}
        onClearQuery={onClearQuery}
      />
    );
  };

  return (
    <div data-library-view="" className="flex min-h-0 flex-1 flex-col">
      <LibraryHeader
        lead={lead}
        insetTitleBar={insetTitleBar}
        scope={scope}
        count={total}
        sort={sort}
        onSortChange={filter === null || q !== null ? null : onSortChange}
        add={{
          ...add,
          newNote: () => {
            add.newNote(noteTarget.folder, noteTarget.tags);
          },
        }}
        onTidy={tidyShown ? onTidy : undefined}
        onEditFilingRules={onEditFilingRules}
        onRenameTag={onRenameTag}
      />
      {strip()}
      {body()}
    </div>
  );
};
