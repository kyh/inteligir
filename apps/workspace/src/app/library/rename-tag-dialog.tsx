// A tag's rename, from the tag scope's header and the rail's tag rows alike: the link rename's
// surgery over every item that holds the tag, its nested tags included.

import { isTagName } from "@repo/notes/knowledge/tag-grammar";
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
import { useState } from "react";

import { failed, orpc } from "../api";
import { sweepKnowledge } from "../change-batch";

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
        failed(cause, "Could not rename the tag.");
      },
      onSuccess: (body) => {
        const count = body.rewritten.length;
        toast.success(`Renamed #${body.from} to #${body.to} in ${plural(count, "item")}.`);
        if (body.skipped.length > 0) {
          toast.warning(
            `Skipped ${body.skipped.map((skip) => skip.path).join(", ")}: changed while renaming.`,
          );
        }
        // the rewritten items' tags, scopes, listings and matches; a tag is no link target's
        // field, so the targets stay, as the bus's own sweep of these writes leaves them
        sweepKnowledge(queryClient);
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
            Every item holding #{tag} is rewritten, nested tags included. An item that changes
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
