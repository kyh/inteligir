// CLAUDE.md § The library is home, and an item is shown by its kind. With nothing open the page is
// the grid of the rail's scope, one card per item, read from the cell's listing a page at a time;
// an empty scope says why and offers a next step.

import { saveFolderOf } from "@repo/client/library-labels";
import { NEEDS_CONNECTION } from "@repo/contract/needs-connection";
import { refusalText } from "@repo/contract/rpc/refusal-text";
import type { ItemKind } from "@repo/contract/items/item-kind";
import { Button } from "@repo/ui/components/button";
import { MediaCardSkeleton } from "@repo/ui/components/media-card";
import { formatCount } from "@repo/ui/lib/plural";
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
import { useQuery } from "@tanstack/react-query";
import { ArrowDownUpIcon, PlusIcon } from "lucide-react";
import { useRef } from "react";

import { TIDY_LABEL } from "../agent/tidy-library";
import { useLibraryQueries } from "../cloud/library-context";
import { LIBRARY_SORTS } from "../prefs";
import type { LibrarySort } from "../prefs";
import { TopBar } from "../top-bar";
import { filesPayload } from "./capture/capture-payload";
import { KindChips } from "./kind-chips";
import { useLibraryCommands } from "./library-commands";
import { LibraryGrid } from "./library-grid";
import type { LibrarySelectionStore } from "./library-selection";
import type { ListingView } from "@repo/client/listing-view";
import type { CellStanding } from "../cloud/needs-connection";

// the scope's listing as the cell has answered it so far
interface LibraryListing {
  readonly standing: CellStanding<ListingView>;
  // what stands is still the listing of the scope or kind the tab left, kept on screen until the
  // new one's first page answers
  readonly placeholder: boolean;
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

export interface LibraryViewProps {
  readonly scope: LibraryScope;
  readonly title: string;
  readonly listing: LibraryListing;
  readonly kind: ItemKind | null;
  readonly sort: LibrarySort;
  readonly onSortChange: (sort: LibrarySort) => void;
  readonly selection: LibrarySelectionStore;
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

// what the shown scope takes: a note, a link, files through the browser's own picker, a folder
const AddMenu = ({ scope }: { scope: LibraryScope }) => {
  const commands = useLibraryCommands();
  const picker = useRef<HTMLInputElement | null>(null);
  return (
    <>
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
              commands.newNote();
            }}
          >
            New note
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              commands.askSaveLink();
            }}
          >
            Save a link…
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              picker.current?.click();
            }}
          >
            Add files…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              commands.newFolder(saveFolderOf(scope));
            }}
          >
            New folder…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        aria-label="Add files"
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])];
          event.currentTarget.value = "";
          if (files.length > 0) {
            commands.save(filesPayload(files));
          }
        }}
      />
    </>
  );
};

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

type LibraryBodyProps = Pick<LibraryViewProps, "scope" | "listing" | "kind" | "selection">;

const LibraryBody = ({ scope, listing, kind, selection }: LibraryBodyProps) => {
  const commands = useLibraryCommands();
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
      <KindChips
        counts={page.kindCounts}
        kind={kind}
        onKindChange={(next) => {
          commands.showKind(next);
        }}
      />
      {page.total === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 p-8 text-center">
          <p className="m-0 text-subtitle font-medium">{empty.title}</p>
          <p className="m-0 text-body text-muted-foreground">{empty.body}</p>
        </div>
      ) : (
        <LibraryGrid
          listing={page}
          shown={listing.placeholder ? null : { kind, scope }}
          selection={selection}
          onNearEnd={more}
        />
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
  sort,
  onSortChange,
  selection,
}: LibraryViewProps) => {
  const commands = useLibraryCommands();
  const counts = useQuery(useLibraryQueries().scopes()).data;
  // offered while something waits to be filed or tagged
  const tidyOffered = counts !== undefined && counts.unsorted + counts.untagged > 0;
  const total = listing.standing.kind === "answered" ? listing.standing.data.total : null;
  return (
    <div className="flex h-full min-h-0 flex-col" data-library-scope={scope.kind}>
      <TopBar className="px-4">
        <h1 className="m-0 truncate text-title font-medium">{title}</h1>
        {total === null ? null : (
          <span className="text-body text-muted-foreground tabular-nums">{formatCount(total)}</span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {tidyOffered && scope.kind !== "deleted" ? (
            <Button
              size="compact"
              variant="ghost"
              onClick={() => {
                commands.startTidy();
              }}
            >
              {TIDY_LABEL}
            </Button>
          ) : null}
          <SortMenu sort={sort} onSortChange={onSortChange} />
          {scope.kind === "deleted" ? (
            <Button
              size="compact"
              variant="destructive"
              disabled={counts === undefined || counts.deleted === 0}
              onClick={() => {
                commands.emptyDeleted();
              }}
            >
              Empty Deleted…
            </Button>
          ) : (
            <AddMenu scope={scope} />
          )}
        </div>
      </TopBar>
      <LibraryBody scope={scope} listing={listing} kind={kind} selection={selection} />
    </div>
  );
};
