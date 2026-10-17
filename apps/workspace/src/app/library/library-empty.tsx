// What the grid's place says when it has nothing to draw: one sentence per case, and the one or
// two things worth doing from there.

import type { LibraryScope } from "@repo/domain/library-scope";
import type { ItemKind } from "@repo/notes/items/item-kind";
import { Button } from "@repo/ui/components/button";
import { MediaCardSkeleton } from "@repo/ui/components/media-card";
import type { ReactNode } from "react";

import { KIND_CHIP_LABELS } from "./item-labels";

export type LibraryEmptyCase =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "search"; q: string }
  | { kind: "chip"; chip: ItemKind }
  | { kind: "scope"; scope: Exclude<LibraryScope, { kind: "deleted" }> };

export interface LibraryEmptyActions {
  saveLink: () => void;
  addFiles: () => void;
  newNote: (folder: string) => void;
  importRaindrop?: (() => void) | undefined;
  showEverything: () => void;
  clearSearch: () => void;
  retry: () => void;
}

const SKELETONS = 12;

const Message = ({
  title,
  body,
  children,
}: {
  title: string;
  body?: string;
  children?: ReactNode;
}) => (
  <div
    aria-live="polite"
    className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center"
  >
    <p className="m-0 text-title font-medium text-ink">{title}</p>
    {body === undefined ? null : (
      <p className="m-0 max-w-sm text-subtitle text-muted-foreground">{body}</p>
    )}
    {children === undefined ? null : (
      <div className="mt-2 flex flex-wrap justify-center gap-2">{children}</div>
    )}
  </div>
);

export const LibraryEmpty = ({
  state,
  actions,
}: {
  state: LibraryEmptyCase;
  actions: LibraryEmptyActions;
}) => {
  switch (state.kind) {
    case "loading": {
      return (
        <div
          aria-busy
          aria-label="Loading the library"
          role="grid"
          className="grid flex-1 auto-rows-[200px] grid-cols-[repeat(auto-fill,minmax(180px,1fr))] content-start gap-4 overflow-hidden p-4"
        >
          {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- one row holds every skeleton cell, laid out by the grid above */}
          <div role="row" className="contents">
            {Array.from({ length: SKELETONS }, (_, index) => (
              <MediaCardSkeleton key={index} />
            ))}
          </div>
        </div>
      );
    }
    case "failed": {
      return (
        <Message title="The library could not be read">
          <Button
            variant="secondary"
            size="compact"
            onClick={() => {
              actions.retry();
            }}
          >
            Retry
          </Button>
        </Message>
      );
    }
    case "search": {
      return (
        <Message title={`Nothing matches “${state.q}”`}>
          <Button
            variant="secondary"
            size="compact"
            onClick={() => {
              actions.clearSearch();
            }}
          >
            Clear
          </Button>
        </Message>
      );
    }
    case "chip": {
      return (
        <Message
          title={`No ${state.chip === "pdf" ? KIND_CHIP_LABELS.pdf : KIND_CHIP_LABELS[state.chip].toLowerCase()} here`}
        >
          <Button
            variant="secondary"
            size="compact"
            onClick={() => {
              actions.showEverything();
            }}
          >
            Show everything
          </Button>
        </Message>
      );
    }
    case "scope": {
      const { scope } = state;
      switch (scope.kind) {
        case "all": {
          return (
            <Message
              title="Your library is empty"
              body="Paste a link here, drop files or links on this window, or save from your browser."
            >
              <Button
                variant="primary"
                size="compact"
                onClick={() => {
                  actions.saveLink();
                }}
              >
                Save a link…
              </Button>
              <Button
                variant="secondary"
                size="compact"
                onClick={() => {
                  actions.addFiles();
                }}
              >
                Add files…
              </Button>
              {actions.importRaindrop === undefined ? null : (
                <Button
                  variant="secondary"
                  size="compact"
                  onClick={() => {
                    actions.importRaindrop?.();
                  }}
                >
                  Import from Raindrop…
                </Button>
              )}
              <Button
                variant="secondary"
                size="compact"
                onClick={() => {
                  actions.newNote("");
                }}
              >
                New note
              </Button>
            </Message>
          );
        }
        case "unsorted": {
          return <Message title="Nothing to sort." />;
        }
        case "folder": {
          return (
            <Message title="This folder is empty">
              <Button
                variant="secondary"
                size="compact"
                onClick={() => {
                  actions.newNote(scope.path);
                }}
              >
                New note here
              </Button>
            </Message>
          );
        }
        case "tag": {
          return <Message title={`No items tagged #${scope.tag}.`} />;
        }
        default: {
          const exhaustive: never = scope;
          return exhaustive;
        }
      }
    }
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
};
