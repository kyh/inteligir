// The small dialogs the library's verbs ask through: a folder to move items to, a tag to add or
// take off, and a name (a new folder's, a renamed one's). Each answers its caller once and closes;
// what the answer writes is the caller's.

import type { ListingFolder } from "@repo/contract/library/library-index";
import { Button } from "@repo/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@repo/ui/components/dialog";
import { Input } from "@repo/ui/components/input";
import { useState } from "react";

import { folderPaths } from "../sidebar/folder-paths";

export interface MoveRequest {
  readonly count: number;
  readonly onMove: (folderId: string | null) => void;
}

export const MoveDialog = ({
  request,
  folders,
  onClose,
}: {
  request: MoveRequest | null;
  folders: readonly ListingFolder[];
  onClose: () => void;
}) => (
  <Dialog
    open={request !== null}
    onOpenChange={(open) => {
      if (!open) {
        onClose();
      }
    }}
  >
    <DialogContent>
      <DialogTitle>
        {request === null || request.count === 1
          ? "Move to"
          : `Move ${String(request.count)} items to`}
      </DialogTitle>
      <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
        {[{ id: null, label: "No folder (Unsorted)" }, ...folderPaths(folders)].map((choice) => (
          <Button
            key={choice.id ?? "none"}
            variant="ghost"
            className="justify-start"
            onClick={() => {
              request?.onMove(choice.id);
              onClose();
            }}
          >
            {choice.label}
          </Button>
        ))}
      </div>
    </DialogContent>
  </Dialog>
);

export interface TagRequest {
  readonly count: number;
  // the tags every subject carries now, which the dialog offers to take off
  readonly held: readonly string[];
  readonly onChange: (change: { add: string[]; remove: string[] }) => void;
}

const cleanTag = (raw: string): string => raw.trim().replace(/^#/u, "").replaceAll(/\s+/gu, "-");

export const TagDialog = ({
  request,
  onClose,
}: {
  request: TagRequest | null;
  onClose: () => void;
}) => {
  const [draft, setDraft] = useState("");
  const close = (): void => {
    setDraft("");
    onClose();
  };
  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) {
          close();
        }
      }}
    >
      <DialogContent>
        <DialogTitle>
          {request === null || request.count === 1 ? "Tag" : `Tag ${String(request.count)} items`}
        </DialogTitle>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const tag = cleanTag(draft);
            if (tag !== "" && request !== null) {
              request.onChange({ add: [tag], remove: [] });
              close();
            }
          }}
        >
          <Input
            aria-label="Tag to add"
            placeholder="Add a tag"
            value={draft}
            autoFocus
            onChange={(event) => {
              setDraft(event.target.value);
            }}
          />
          <Button type="submit" disabled={cleanTag(draft) === ""}>
            Add
          </Button>
        </form>
        {request === null || request.held.length === 0 ? null : (
          <div className="flex flex-wrap gap-1.5">
            {request.held.map((tag) => (
              <Button
                key={tag}
                size="compact"
                variant="secondary"
                aria-label={`Remove the tag ${tag}`}
                onClick={() => {
                  request.onChange({ add: [], remove: [tag] });
                  close();
                }}
              >
                #{tag} ×
              </Button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export interface NameRequest {
  readonly title: string;
  readonly label: string;
  readonly initial: string;
  readonly confirm: string;
  readonly onSubmit: (name: string) => void;
  // why this text can't be taken, which holds the dialog open on it
  readonly refuse?: (name: string) => string | null;
}

export const NameDialog = ({
  request,
  onClose,
}: {
  request: NameRequest | null;
  onClose: () => void;
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const value = draft ?? request?.initial ?? "";
  const close = (): void => {
    setDraft(null);
    setRefusal(null);
    onClose();
  };
  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) {
          close();
        }
      }}
    >
      <DialogContent>
        <DialogTitle>{request?.title ?? ""}</DialogTitle>
        <DialogDescription>{request?.label ?? ""}</DialogDescription>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const name = value.trim();
            if (name === "" || request === null) {
              return;
            }
            const refused = request.refuse?.(name) ?? null;
            setRefusal(refused);
            if (refused === null) {
              request.onSubmit(name);
              close();
            }
          }}
        >
          <Input
            aria-label={request?.label ?? "Name"}
            value={value}
            autoFocus
            onChange={(event) => {
              setDraft(event.target.value);
              setRefusal(null);
            }}
          />
          <Button type="submit" disabled={value.trim() === ""}>
            {request?.confirm ?? "Save"}
          </Button>
        </form>
        {refusal === null ? null : (
          <p role="alert" className="m-0 text-body text-destructive">
            {refusal}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
};
