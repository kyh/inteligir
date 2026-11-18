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

export type ListingPlaceholder = "same-scope" | "other-scope" | null;

interface LibraryListing {
  readonly standing: CellStanding<ListingView>;
  readonly placeholder: ListingPlaceholder;
  readonly more: () => void;
}

const SKELETON_CARDS = ["a", "b", "c", "d", "e", "f"] as const;

const SORT_LABELS = {
  modified: "Last changed",
  saved: "Date saved",
  title: "Title",
} satisfies Record<LibrarySort, string>;

const sortNamed = (value: string) => LIBRARY_SORTS.find((sort) => sort === value) ?? null;

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

const emptyWords = (scope: LibraryScope) => {
  switch (scope.kind) {
    case "deleted": {
      return {
        body: "What you delete waits here until you empty it.",
        title: "Nothing deleted",
      } satisfies EmptyWords;
    }

    case "unsorted": {
      return {
        body: "Everything here is in a folder.",
        title: "Nothing unsorted",
      } satisfies EmptyWords;
    }

    case "tag": {
      return {
        body: "No item carries this tag now.",
        title: "Nothing tagged",
      } satisfies EmptyWords;
    }

    case "folder": {
      return {
        body: "Save a link here, add a file, or write a note.",
        title: "This folder is empty",
      } satisfies EmptyWords;
    }

    case "all": {
      return {
        body: "Save a link, add a file or write a note, and it appears here.",
        title: "Your library is empty",
      } satisfies EmptyWords;
    }

    default: {
      throw new Error(`unexpected ${String(scope satisfies never)}`);
    }
  }
};

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

const Skeleton = () => (
  <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4 p-4" aria-busy>
    {SKELETON_CARDS.map((key) => (
      <MediaCardSkeleton key={key} />
    ))}
  </div>
);

type LibraryBodyProps = Pick<LibraryViewProps, "scope" | "listing" | "kind" | "selection">;

const LibraryBody = ({ scope, listing, kind, selection }: LibraryBodyProps) => {
  const commands = useLibraryCommands();
  const { standing, more, placeholder } = listing;

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
      return <Skeleton />;
    }

    case "answered": {
      break;
    }

    default: {
      throw new Error(`unexpected ${String(standing satisfies never)}`);
    }
  }

  const page = standing.data;

  if (placeholder !== null && page.total === 0) {
    return <Skeleton />;
  }

  const empty = emptyWords(scope);

  return (
    <>
      {placeholder === "other-scope" ? null : (
        <KindChips
          counts={page.kindCounts}
          kind={kind}
          onKindChange={(next) => {
            commands.showKind(next);
          }}
        />
      )}
      {page.total === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 p-8 text-center">
          <p className="m-0 text-subtitle font-medium">{empty.title}</p>
          <p className="m-0 text-body text-muted-foreground">{empty.body}</p>
        </div>
      ) : (
        <LibraryGrid
          listing={page}
          shown={placeholder === null ? { kind, scope } : null}
          selection={selection}
          onNearEnd={more}
        />
      )}
    </>
  );
};

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
  const tidyOffered = counts !== undefined && counts.unsorted + counts.untagged > 0;

  const total =
    listing.standing.kind === "answered" && listing.placeholder !== "other-scope"
      ? listing.standing.data.total
      : null;

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
