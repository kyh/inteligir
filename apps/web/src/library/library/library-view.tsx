// CLAUDE.md § The library is home, and an item is shown by its kind. With nothing open the page is
// the grid of the rail's scope, one card per item, read from the cell's listing a page at a time;
// an empty scope says why and offers a next step.

import { NEEDS_CONNECTION } from "@repo/contract/needs-connection";
import { refusalText } from "@repo/contract/refusal-text";
import type { ItemKind } from "@repo/contract/items/item-kind";
import { Button } from "@repo/ui/components/button";
import { MediaCardSkeleton } from "@repo/ui/components/media-card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import type { LibraryScope } from "@repo/contract/library-scope";
import { ArrowDownUpIcon, PlusIcon } from "lucide-react";

import { TIDY_LABEL } from "../agent/tidy-library";
import { LIBRARY_SORTS } from "../prefs";
import type { LibrarySort } from "../prefs";
import { TopBar } from "../top-bar";
import { formatCount } from "./item-labels";
import type { LibraryGridActions } from "./item-menu";
import { KindChips } from "./kind-chips";
import { LibraryGrid } from "./library-grid";
import type { LibrarySelectionStore } from "./library-selection";
import type { ListingView } from "./listing";
import type { CellStanding } from "../cloud/needs-connection";

// the scope's listing as the cell has answered it so far
interface LibraryListing {
  readonly standing: CellStanding<ListingView>;
  // the grid came near the end of what is read
  readonly more: () => void;
}

// what the grid draws while the listing is first read
const SKELETON_CARDS = ["a", "b", "c", "d", "e", "f"] as const;

const SORT_LABELS = {
  modified: "Last changed",
  saved: "Date saved",
  title: "Title",
} satisfies Record<LibrarySort, string>;

const sortNamed = (value: string): LibrarySort | null =>
  LIBRARY_SORTS.find((sort) => sort === value) ?? null;

interface LibraryAdd {
  readonly newNote: () => void;
  readonly saveLink: () => void;
  readonly addFiles: () => void;
  readonly newFolder: () => void;
}

export interface LibraryViewProps {
  readonly scope: LibraryScope;
  readonly title: string;
  readonly listing: LibraryListing;
  readonly kind: ItemKind | null;
  readonly onKindChange: (kind: ItemKind | null) => void;
  readonly sort: LibrarySort;
  readonly onSortChange: (sort: LibrarySort) => void;
  readonly selection: LibrarySelectionStore;
  readonly actions: LibraryGridActions;
  readonly add: LibraryAdd;
  readonly onEmptyDeleted: () => void;
  // offered while the library holds items to file or tag
  readonly onTidy: (() => void) | null;
}

interface EmptyWords {
  readonly title: string;
  readonly body: string;
}

const emptyWords = (scope: LibraryScope): EmptyWords => {
  switch (scope.kind) {
    case "deleted": {
      return { body: "What you delete waits here until you empty it.", title: "Nothing deleted" };
    }
    case "unsorted": {
      return { body: "Everything here is in a folder.", title: "Nothing unsorted" };
    }
    case "tag": {
      return { body: "No item carries this tag now.", title: "Nothing tagged" };
    }
    case "folder": {
      return {
        body: "Save a link here, add a file, or write a note.",
        title: "This folder is empty",
      };
    }
    case "all": {
      return {
        body: "Save a link, add a file or write a note, and it appears here.",
        title: "Your library is empty",
      };
    }
    // no default
  }
};

const AddMenu = ({ add }: { add: LibraryAdd }) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      render={<Button size="compact" variant="secondary" aria-label="Add to the library" />}
    >
      <PlusIcon />
      Add
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem
        onClick={() => {
          add.newNote();
        }}
      >
        New note
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => {
          add.saveLink();
        }}
      >
        Save a link…
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => {
          add.addFiles();
        }}
      >
        Add files…
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onClick={() => {
          add.newFolder();
        }}
      >
        New folder…
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);

const SortMenu = ({
  sort,
  onSortChange,
}: {
  sort: LibrarySort;
  onSortChange: (sort: LibrarySort) => void;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      render={<Button size="compact" variant="ghost" aria-label="Sort the library" />}
    >
      <ArrowDownUpIcon />
      {SORT_LABELS[sort]}
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuRadioGroup
        value={sort}
        onValueChange={(value) => {
          const picked = sortNamed(value);
          if (picked !== null) {
            onSortChange(picked);
          }
        }}
      >
        {LIBRARY_SORTS.map((option) => (
          <DropdownMenuRadioItem key={option} value={option}>
            {SORT_LABELS[option]}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
);

type LibraryBodyProps = Pick<
  LibraryViewProps,
  "scope" | "listing" | "kind" | "onKindChange" | "selection" | "actions"
>;

const LibraryBody = ({
  scope,
  listing,
  kind,
  onKindChange,
  selection,
  actions,
}: LibraryBodyProps) => {
  const { standing, more } = listing;
  switch (standing.kind) {
    case "needs-connection": {
      return (
        <p className="m-0 p-4 text-body text-muted-foreground" data-needs-connection>
          {NEEDS_CONNECTION}
        </p>
      );
    }
    case "missing":
    case "unreachable": {
      return (
        <p className="m-0 p-4 text-body text-muted-foreground">
          {refusalText(standing.error, "Your library couldn't be read.")}
        </p>
      );
    }
    case "loading": {
      return (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4 p-4" aria-busy>
          {SKELETON_CARDS.map((key) => (
            <MediaCardSkeleton key={key} />
          ))}
        </div>
      );
    }
    case "answered": {
      break;
    }
    // no default
  }
  const page = standing.data;
  const empty = emptyWords(scope);
  return (
    <>
      <KindChips counts={page.kindCounts} kind={kind} onKindChange={onKindChange} />
      {page.total === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 p-8 text-center">
          <p className="m-0 text-subtitle font-medium">{empty.title}</p>
          <p className="m-0 text-body text-muted-foreground">{empty.body}</p>
        </div>
      ) : (
        <LibraryGrid rows={page.items} selection={selection} actions={actions} onNearEnd={more} />
      )}
    </>
  );
};

// the bar stands from the first frame, so the answer fills in under it and nothing above the cards moves
export const LibraryView = ({
  scope,
  title,
  listing,
  kind,
  onKindChange,
  sort,
  onSortChange,
  selection,
  actions,
  add,
  onEmptyDeleted,
  onTidy,
}: LibraryViewProps) => {
  const total = listing.standing.kind === "answered" ? listing.standing.data.total : null;
  return (
    <div className="flex h-full min-h-0 flex-col" data-library-scope={scope.kind}>
      <TopBar className="px-4">
        <h1 className="m-0 truncate text-title font-medium">{title}</h1>
        {total === null ? null : (
          <span className="text-body text-muted-foreground tabular-nums">{formatCount(total)}</span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {onTidy === null || scope.kind === "deleted" ? null : (
            <Button size="compact" variant="ghost" onClick={onTidy}>
              {TIDY_LABEL}
            </Button>
          )}
          <SortMenu sort={sort} onSortChange={onSortChange} />
          {scope.kind === "deleted" ? (
            <Button
              size="compact"
              variant="destructive"
              disabled={total === null || total === 0}
              onClick={onEmptyDeleted}
            >
              Empty Deleted…
            </Button>
          ) : (
            <AddMenu add={add} />
          )}
        </div>
      </TopBar>
      <LibraryBody
        scope={scope}
        listing={listing}
        kind={kind}
        onKindChange={onKindChange}
        selection={selection}
        actions={actions}
      />
    </div>
  );
};
