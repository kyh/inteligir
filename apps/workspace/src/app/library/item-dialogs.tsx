// The two small forms a card's or Info's verbs ask through: tags to add to or take from any
// number of items, and a name (an item's rename, a new folder).

import { checkNoteName, noteNameErrorMessage } from "@repo/notes/knowledge/note-name";
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
import { plural } from "@repo/ui/lib/plural";
import { useState } from "react";

// "#a b, c" → ["a", "b", "c"]: a person types tags the way they write them
export const tagsFromText = (text: string): string[] => [
  ...new Set(
    text
      .split(/[\s,]+/u)
      .map((tag) => tag.trim().replace(/^#/u, ""))
      .filter((tag) => tag !== ""),
  ),
];

export interface TagDialogRequest {
  readonly paths: readonly string[];
}

export const TagDialog = ({
  request,
  onClose,
  onApply,
}: {
  request: TagDialogRequest | null;
  onClose: () => void;
  onApply: (paths: readonly string[], change: { add: string[]; remove: string[] }) => void;
}) => {
  const [text, setText] = useState("");
  const [openedFor, setOpenedFor] = useState<TagDialogRequest | null>(null);
  if (openedFor !== request) {
    setOpenedFor(request);
    setText("");
  }
  const tags = tagsFromText(text);
  const bad = tags.filter((tag) => !isTagName(tag));
  const usable = tags.length > 0 && bad.length === 0;
  const count = request?.paths.length ?? 0;
  const apply = (which: "add" | "remove"): void => {
    if (request === null || !usable) {
      return;
    }
    onApply(request.paths, which === "add" ? { add: tags, remove: [] } : { add: [], remove: tags });
    onClose();
  };
  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{count === 1 ? "Tag item" : `Tag ${plural(count, "item")}`}</DialogTitle>
          <DialogDescription>
            Type one or more tags. Add puts them on, Remove takes them off.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            apply("add");
          }}
        >
          <Input
            aria-label="Tags"
            autoFocus
            placeholder="reading, #to-read"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
            }}
          />
          {bad.length > 0 ? (
            <p className="m-0 text-body text-destructive">
              {bad.map((tag) => `#${tag}`).join(", ")} can’t be a tag.
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="tertiary"
              size="compact"
              disabled={!usable}
              onClick={() => {
                apply("remove");
              }}
            >
              Remove
            </Button>
            <Button type="submit" size="compact" disabled={!usable}>
              Add
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export interface NameDialogRequest {
  readonly title: string;
  readonly label: string;
  readonly initial: string;
  readonly confirm: string;
  readonly onSubmit: (name: string) => void;
}

export const NameDialog = ({
  request,
  onClose,
}: {
  request: NameDialogRequest | null;
  onClose: () => void;
}) => {
  const [value, setValue] = useState("");
  const [openedFor, setOpenedFor] = useState<NameDialogRequest | null>(null);
  if (openedFor !== request) {
    setOpenedFor(request);
    setValue(request?.initial ?? "");
  }
  const trimmed = value.trim();
  const verdict = trimmed === "" ? null : checkNoteName(trimmed);
  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{request?.title ?? ""}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (request !== null && verdict?.ok === true && verdict.name !== request.initial) {
              request.onSubmit(verdict.name);
            }
            onClose();
          }}
        >
          <Input
            aria-label={request?.label ?? "Name"}
            autoFocus
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
            }}
          />
          {verdict !== null && !verdict.ok ? (
            <p className="m-0 text-body text-destructive">{noteNameErrorMessage(verdict.reason)}</p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="tertiary" size="compact" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="compact" disabled={verdict?.ok !== true}>
              {request?.confirm ?? "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
