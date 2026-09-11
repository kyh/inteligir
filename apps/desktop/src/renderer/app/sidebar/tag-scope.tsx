import { isTagName } from "@repo/notes/knowledge/link-extract";
import { Button } from "@repo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import { Input } from "@repo/ui/components/input";
import { toast } from "@repo/ui/components/sonner";
import { plural } from "@repo/ui/lib/plural";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, PencilIcon } from "lucide-react";
import { useState } from "react";

import { orpc, refusalMessage } from "../api";

export interface TagScopeCount {
  // how many of the family the listing holds, and how many there are
  listed: number;
  total: number;
}

// the count says when the list is cut, so a cut is never mistaken for the whole
export const tagScopeCountLabel = ({ listed, total }: TagScopeCount): string =>
  listed < total ? `${String(listed)} of ${String(total)}` : String(total);

export const TagScopeHeader = ({
  tag,
  count,
  onClear,
  onRename,
}: {
  tag: string;
  count: TagScopeCount | undefined;
  onClear: () => void;
  onRename: () => void;
}) => (
  <div className="flex items-center gap-1 py-1">
    <Button variant="ghost" size="icon-compact" aria-label="Every note" onClick={onClear}>
      <ArrowLeftIcon />
    </Button>
    <span className="min-w-0 flex-1 truncate text-sm font-medium">#{tag}</span>
    {count === undefined ? null : (
      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
        {tagScopeCountLabel(count)}
      </span>
    )}
    <Button variant="ghost" size="icon-compact" aria-label={`Rename ${tag}`} onClick={onRename}>
      <PencilIcon />
    </Button>
  </div>
);

export const RenameTagDialog = ({
  tag,
  onOpenChange,
  onRenamed,
}: {
  tag: string | null;
  onOpenChange: (open: boolean) => void;
  onRenamed: (from: string, to: string) => void;
}) => {
  const queryClient = useQueryClient();
  const [value, setValue] = useState("");
  // seeded during render, so the field never paints the previous tag's text
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (openedFor !== tag) {
    setOpenedFor(tag);
    setValue(tag ?? "");
  }
  const rename = useMutation(
    orpc.knowledge.renameTag.mutationOptions({
      onError: (cause) => {
        toast.error(refusalMessage(cause, "Could not rename the tag."));
      },
      onSuccess: (body) => {
        const count = body.rewritten.length;
        toast.success(`Renamed #${body.from} to #${body.to} in ${plural(count, "note")}.`);
        if (body.skipped.length > 0) {
          toast.warning(
            `Skipped ${body.skipped.map((skip) => skip.path).join(", ")}: changed while renaming.`,
          );
        }
        void queryClient.invalidateQueries({ queryKey: orpc.knowledge.key() });
        onOpenChange(false);
        onRenamed(body.from, body.to);
      },
    }),
  );
  const next = value.trim().replace(/^#/u, "");
  const valid = tag !== null && isTagName(next) && next !== tag;
  return (
    <Dialog open={tag !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename tag</DialogTitle>
          <DialogDescription>
            Every note holding #{tag} is rewritten, nested tags included. A note that changes
            mid-rename is skipped, never overwritten.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && tag !== null) {
              rename.mutate({ from: tag, to: next });
            }
          }}
        >
          <Input
            aria-label="New tag name"
            autoFocus
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
            }}
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="tertiary"
              size="compact"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" size="compact" disabled={!valid || rename.isPending}>
              Rename
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
