// The library's top bar: the way back and forth and the scope's name and count on the left; the
// sort, "+ Add", Tidy and the panel's toggle on the right. A tag scope keeps its rename here.

import type { LibraryScope } from "@repo/domain/library-scope";
import { basenamePath } from "@repo/notes/knowledge/vault-path";
import { Button } from "@repo/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import {
  ArrowDownUpIcon,
  CheckIcon,
  FilePlusIcon,
  FolderPlusIcon,
  ImportIcon,
  LinkIcon,
  PaperclipIcon,
  PencilIcon,
  PlusIcon,
  SparklesIcon,
} from "lucide-react";

import { PanelToggle, TopbarLead, TopbarShell } from "../topbar-lead";
import type { TopbarLeadProps } from "../topbar-lead";
import { formatCount } from "./item-labels";
import type { LibrarySort } from "./library-items";

export const scopeTitle = (scope: LibraryScope): string => {
  switch (scope.kind) {
    case "all": {
      return "All items";
    }
    case "unsorted": {
      return "Unsorted";
    }
    case "folder": {
      return basenamePath(scope.path);
    }
    case "tag": {
      return `#${scope.tag}`;
    }
    case "deleted": {
      return "Deleted";
    }
    default: {
      const exhaustive: never = scope;
      return exhaustive;
    }
  }
};

const SORT_LABELS = {
  modified: "Last changed",
  saved: "Date saved",
  title: "Name",
} satisfies Record<LibrarySort, string>;

const SORTS: readonly LibrarySort[] = ["saved", "modified", "title"];

// what "+ Add" offers; Import is offered only where its page exists
export interface LibraryAddActions {
  saveLink: () => void;
  addFiles: () => void;
  newNote: () => void;
  newFolder: () => void;
  importRaindrop?: () => void;
}

export interface LibraryHeaderProps {
  lead: TopbarLeadProps;
  insetTitleBar: boolean;
  scope: LibraryScope;
  count: number | null;
  sort: LibrarySort;
  // null: the order is the search's ranking, or Deleted's, and no sort applies
  onSortChange: ((sort: LibrarySort) => void) | null;
  add: LibraryAddActions;
  // shown while something is Unsorted or untagged
  onTidy?: (() => void) | undefined;
  onRenameTag: (tag: string) => void;
}

export const LibraryHeader = ({
  lead,
  insetTitleBar,
  scope,
  count,
  sort,
  onSortChange,
  add,
  onTidy,
  onRenameTag,
}: LibraryHeaderProps) => (
  <TopbarShell insetTitleBar={insetTitleBar} railOpen={lead.railOpen}>
    <TopbarLead {...lead} />
    <h1 className="ml-2 min-w-0 truncate text-title font-semibold text-ink">{scopeTitle(scope)}</h1>
    {count === null ? null : (
      <span className="ml-2 shrink-0 text-body text-muted-foreground tabular-nums">
        {formatCount(count)}
      </span>
    )}
    {scope.kind === "tag" ? (
      <Button
        variant="ghost"
        size="icon-compact"
        aria-label={`Rename #${scope.tag}`}
        onClick={() => {
          onRenameTag(scope.tag);
        }}
      >
        <PencilIcon />
      </Button>
    ) : null}
    <div className="ml-auto flex shrink-0 items-center gap-0.5">
      {onSortChange === null ? null : (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="compact" leadingIcon={ArrowDownUpIcon}>
                {SORT_LABELS[sort]}
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            {SORTS.map((option) => (
              <DropdownMenuItem
                key={option}
                onClick={() => {
                  onSortChange(option);
                }}
              >
                {option === sort ? <CheckIcon /> : <span className="size-3.5" />}
                {SORT_LABELS[option]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {onTidy === undefined ? null : (
        <Button variant="ghost" size="compact" leadingIcon={SparklesIcon} onClick={onTidy}>
          Tidy my library
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="compact" leadingIcon={PlusIcon}>
              Add
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => {
              add.saveLink();
            }}
          >
            <LinkIcon />
            Save link…
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              add.addFiles();
            }}
          >
            <PaperclipIcon />
            Add files…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              add.newNote();
            }}
          >
            <FilePlusIcon />
            New note
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              add.newFolder();
            }}
          >
            <FolderPlusIcon />
            New folder
          </DropdownMenuItem>
          {add.importRaindrop === undefined ? null : (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  add.importRaindrop?.();
                }}
              >
                <ImportIcon />
                Import from Raindrop…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <PanelToggle />
    </div>
  </TopbarShell>
);
