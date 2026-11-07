// CLAUDE.md § HISTORY IS CHANGE SETS, AND UNDO IS ONE. An item's history as the cell keeps it: each
// change set that touched it, by who and when, newest first, and the item as that set left it. Undo
// takes a whole set back, in a change set of its own, so an undo is itself in History; a line
// changed since the set is kept, and the answer says so. History lives in the cell, so it waits
// for a connection; it reads a page of sets at a time, the older ones on "Show older".

import { changeSetsOf } from "@repo/agent-panel/thread-undo";
import { itemView } from "@repo/editor/codec/item-view";
import { Button } from "@repo/ui/components/button";
import { Dialog, DialogContent, DialogTitle } from "@repo/ui/components/dialog";
import { toast } from "@repo/ui/components/sonner";
import {
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";

import { historyPages, UNDO_SCOPE, useUndoWaits } from "../cloud/history-pages";
import { useReplica, useWire } from "../cloud/library-context";
import { refusalText } from "@repo/contract/cloud/refusal-text";
import { CellAnswer } from "../cloud/needs-connection";
import { relativeTimeLabel, useNow } from "../relative-time";

interface ShownRevision {
  readonly rev: number;
  readonly label: string;
}

interface UndoAnswer {
  readonly kept: readonly string[];
  readonly refused: readonly string[];
  readonly reverted: readonly string[];
}

const NOTHING_UNDONE =
  "Nothing was undone. Changes made since were kept where they overlapped, so you can undo this again.";

// what an undo's answer says: what it took back, what a later change kept as it is, and what a
// rule held back, which Undo can still take
/** @internal */
export const undoSentence = (answer: UndoAnswer) => {
  if (answer.refused.length > 0) {
    return "Partly undone. Some items couldn't come back yet, so you can undo this again.";
  }
  if (answer.kept.length === 0) {
    return "Undone.";
  }
  return answer.reverted.length === 0
    ? NOTHING_UNDONE
    : "Undone, but changes made since were kept where they overlapped.";
};

// an undo that took nothing back is no success
export const announceUndo = (answer: UndoAnswer): void => {
  const sentence = undoSentence(answer);
  if (sentence === NOTHING_UNDONE) {
    toast.info(sentence);
  } else {
    toast.success(sentence);
  }
};

const RevisionDialog = ({
  itemId,
  shown,
  onClose,
}: {
  itemId: string;
  shown: ShownRevision | null;
  onClose: () => void;
}) => {
  const { orpc } = useWire();
  const replica = useReplica();
  const revision = useQuery(
    orpc.library.history.revision.queryOptions({
      input: shown === null ? skipToken : { itemId, rev: shown.rev },
    }),
  );
  return (
    <Dialog
      open={shown !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogTitle>{shown?.label ?? ""}</DialogTitle>
        <CellAnswer query={revision} failed="This version couldn't be read.">
          {(data) => (
            <pre className="max-h-[60vh] overflow-auto font-mono text-body whitespace-pre-wrap select-text">
              {data.fields.title === "" ? "" : `${data.fields.title}\n\n`}
              {
                itemView(new Map(data.blocks.map((stored) => [stored.block.id, stored])), {
                  title: (linked) => replica.row(linked)?.title ?? null,
                }).markdown
              }
            </pre>
          )}
        </CellAnswer>
      </DialogContent>
    </Dialog>
  );
};

export const HistoryTab = ({
  itemId,
  flushOpen,
}: {
  itemId: string;
  // writes what the open item holds unsaved, so an undo meets the item as the person sees it
  flushOpen: () => Promise<void>;
}) => {
  const { orpc } = useWire();
  const queryClient = useQueryClient();
  const nowMs = useNow();
  const [shown, setShown] = useState<ShownRevision | null>(null);
  const history = useInfiniteQuery(historyPages(orpc, { itemId }));
  const undo = useMutation(
    orpc.library.history.undo.mutationOptions({
      onError: (cause) => {
        toast.error(refusalText(cause, "That change couldn't be undone."));
      },
      onMutate: flushOpen,
      // refused too: an open list hears nothing of what another device took back, so a refusal can
      // be the first it learns of it
      onSettled: async () => {
        await queryClient.invalidateQueries({ queryKey: orpc.library.history.key() });
      },
      onSuccess: (answer) => {
        announceUndo(answer);
      },
      scope: UNDO_SCOPE,
    }),
  );
  const undoWaits = useUndoWaits();
  return (
    <>
      <CellAnswer query={history} failed="History couldn't be read.">
        {({ pages }) => (
          <ol className="m-0 flex list-none flex-col gap-2 p-3" aria-label="History">
            {changeSetsOf(pages).map((set) => {
              const rev = set.items.find((item) => item.id === itemId)?.rev ?? null;
              const when = relativeTimeLabel(Date.parse(set.openedAt), nowMs);
              return (
                <li
                  key={set.id}
                  data-change-set={set.id}
                  className="flex flex-col gap-1 rounded-md border border-border p-2.5"
                >
                  <span className="text-body font-medium">{set.label}</span>
                  <span className="text-caption text-muted-foreground">
                    {when}
                    {set.itemCount > 1 ? ` · ${String(set.itemCount)} items` : ""}
                    {set.undoneBy === null ? "" : " · undone"}
                  </span>
                  <div className="flex gap-1.5">
                    {rev === null ? null : (
                      <Button
                        size="compact"
                        variant="ghost"
                        onClick={() => {
                          setShown({ label: `${set.label}, ${when}`, rev });
                        }}
                      >
                        Show this version
                      </Button>
                    )}
                    <Button
                      size="compact"
                      variant="secondary"
                      disabled={set.undoneBy !== null || set.closedAt === null || undoWaits}
                      onClick={() => {
                        undo.mutate({ changeSetIds: [set.id] });
                      }}
                    >
                      Undo
                    </Button>
                  </div>
                </li>
              );
            })}
            {history.hasNextPage ? (
              <li>
                <Button
                  size="compact"
                  variant="ghost"
                  disabled={history.isFetchingNextPage}
                  onClick={() => {
                    void history.fetchNextPage();
                  }}
                >
                  Show older
                </Button>
              </li>
            ) : null}
          </ol>
        )}
      </CellAnswer>
      <RevisionDialog
        itemId={itemId}
        shown={shown}
        onClose={() => {
          setShown(null);
        }}
      />
    </>
  );
};
