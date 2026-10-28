// CLAUDE.md § AN ITEM'S INFO IS READ FROM THE INDEX AND WRITTEN AS A FRONTMATTER LINE EDIT. The
// panel's first tab, about whatever the panel is about: the open item, else the one selected,
// else the selection, else the scope the library shows. An item's facts are its index row, so
// Info reads no file; its fields are written by `editItemFields` and its tags by `retagItems`.

import type { LibraryScope } from "@repo/domain/library-scope";
import { useLiveEditor } from "@repo/editor/live-editor";
import { PropertiesPanel } from "@repo/editor/properties/properties-panel";
import { TagsField } from "@repo/editor/properties/property-fields";
import { openExternalUrl } from "@repo/editor/lib/open-external-url";
import { parseItemTime } from "@repo/notes/items/item-time";
import { TAGS_KEY } from "@repo/notes/markdown/frontmatter";
import type { TypedProperty } from "@repo/notes/markdown/frontmatter";
import { dirnamePath } from "@repo/notes/knowledge/vault-path";
import type { ItemRowWire } from "@repo/contract/local/items/items-schema";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Textarea } from "@repo/ui/components/textarea";
import { toast } from "@repo/ui/components/sonner";
import { isImeComposing } from "@repo/ui/lib/ime";
import { plural } from "@repo/ui/lib/plural";
import {
  ArchiveIcon,
  ExternalLinkIcon,
  FolderInputIcon,
  FolderSearchIcon,
  LinkIcon,
  MessageSquareIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  RefreshCwIcon,
  TagIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { client } from "../api";
import { FoldSection } from "../fold-section";
import { formatCount, isUrlItem, KIND_LABELS } from "../library/item-labels";
import { copyItemLink } from "../library/item-menu";
import type { LibraryItemActions } from "../library/item-menu";
import { scopeTitle } from "../library/library-header";
import { useItemRow, useLibraryScopes } from "../library/library-items";
import { editItemFields, retagItems } from "../note/item-frontmatter";
import { useVaultStatus } from "../vault-hooks";
import { NoteFacts } from "./note-facts";
import { RelatedInline } from "./related-section";

// what the panel is about: the open item, else one selected, else the selection, else the scope
export type PanelSubject =
  | { kind: "item"; path: string }
  | { kind: "selection"; paths: readonly string[]; all: boolean; scope: LibraryScope }
  | { kind: "scope"; scope: LibraryScope };

export interface InfoActions extends LibraryItemActions {
  // the selection's own paths, ⌘A's read from the listing first
  withSelection: (run: (paths: readonly string[]) => void) => void;
  onRenameTag: (tag: string) => void;
  onRenameFolder: (path: string) => void;
}

// the item's own frontmatter keys hidden, every other one editable while the editor is live
export const InlineProperties = ({
  docPath,
  open,
  onOpenChange,
}: {
  docPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const editor = useLiveEditor(open ? docPath : null);
  return (
    <FoldSection label="More properties" open={open} onOpenChange={onOpenChange}>
      <div className="px-3 pb-2">
        {editor === null ? (
          <p className="pb-1 text-body text-muted-foreground">Open the item to edit properties.</p>
        ) : (
          <PropertiesPanel editor={editor} />
        )}
      </div>
    </FoldSection>
  );
};

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="grid grid-cols-[5.5rem_1fr] items-start gap-2 py-0.5">
    <span className="pt-1 text-body text-muted-foreground">{label}</span>
    <div className="min-w-0 text-body text-ink">{children}</div>
  </div>
);

const dateLabel = (ms: number | null): string =>
  ms === null
    ? "—"
    : new Date(ms).toLocaleString(undefined, {
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        month: "short",
        year: "numeric",
      });

const reportEdit = async (run: Promise<{ kind: string; message?: string }>): Promise<void> => {
  const outcome = await run;
  if (outcome.kind === "refused" && outcome.message !== undefined) {
    toast.error(outcome.message);
  }
};

// a one-line field that writes on Enter or on leaving it, and puts back what it held on Escape
const EditableLine = ({
  label,
  value,
  placeholder,
  multiline = false,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder: string;
  multiline?: boolean;
  onCommit: (next: string) => void;
}) => {
  const [draft, setDraft] = useState(value);
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setDraft(value);
  }
  const commit = (): void => {
    if (draft.trim() !== value.trim()) {
      onCommit(draft.trim());
    }
  };
  const common = {
    "aria-label": label,
    onBlur: commit,
    placeholder,
    value: draft,
  };
  return multiline ? (
    <Textarea
      {...common}
      rows={3}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onKeyDown={(event) => {
        if (isImeComposing(event)) {
          return;
        }
        if (event.key === "Escape") {
          setDraft(value);
        }
      }}
    />
  ) : (
    <Input
      {...common}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onKeyDown={(event) => {
        // the keys of a composition are the composer's: its Enter commits a candidate
        if (isImeComposing(event)) {
          return;
        }
        if (event.key === "Enter") {
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          setDraft(value);
        }
      }}
    />
  );
};

const AddressRow = ({ row }: { row: ItemRowWire }) => (
  <Row label="Address">
    <EditableLine
      label="Address"
      value={row.url ?? ""}
      placeholder="https://"
      onCommit={(next) => {
        void reportEdit(editItemFields(client, row.path, { url: next === "" ? null : next }));
      }}
    />
    <div className="-ml-2 flex flex-wrap pt-0.5">
      {row.url === null ? null : (
        <Button
          variant="ghost"
          size="compact"
          leadingIcon={ExternalLinkIcon}
          onClick={() => {
            if (row.url !== null) {
              openExternalUrl(row.url);
            }
          }}
        >
          Open original
        </Button>
      )}
      <Button
        variant="ghost"
        size="compact"
        leadingIcon={LinkIcon}
        onClick={() => {
          copyItemLink(row.path);
        }}
      >
        Copy link
      </Button>
    </div>
  </Row>
);

// what a doc's own frontmatter says: its description and its tags, both editable here
const DocFields = ({ row }: { row: ItemRowWire }) => {
  const tagsProp: Extract<TypedProperty, { type: "tags" }> = {
    key: TAGS_KEY,
    type: "tags",
    value: row.tags,
  };
  return (
    <>
      <Row label="Description">
        <EditableLine
          label="Description"
          value={row.description ?? ""}
          placeholder="Add a description"
          multiline
          onCommit={(next) => {
            void reportEdit(
              editItemFields(client, row.path, { description: next === "" ? null : next }),
            );
          }}
        />
      </Row>
      <Row label="Tags">
        <TagsField
          prop={tagsProp}
          onChange={(next) => {
            if (next.type !== "tags") {
              return;
            }
            const add = next.value.filter((tag) => !row.tags.includes(tag));
            const remove = row.tags.filter((tag) => !next.value.includes(tag));
            if (add.length + remove.length > 0) {
              void retagItems([row.path], { add, remove });
            }
          }}
        />
      </Row>
    </>
  );
};

// what went wrong with the item, said where its facts are
const ItemNotices = ({ row, actions }: { row: ItemRowWire; actions: InfoActions }) => {
  const statusQuery = useVaultStatus();
  const tooLarge = statusQuery.data?.tooLarge.files ?? [];
  const onlyHere = row.file !== null && tooLarge.some((file) => file.path === row.file);
  return (
    <>
      {row.fetchError === null ? null : (
        <div className="mt-1 rounded-md bg-muted/50 px-2.5 py-2 text-body">
          <p className="m-0 text-ink">{row.fetchError}</p>
          <Button
            variant="ghost"
            size="compact"
            className="-ml-2"
            leadingIcon={RefreshCwIcon}
            onClick={(event) => {
              actions.refresh(row.path, event.altKey);
            }}
          >
            Refresh from the page
          </Button>
        </div>
      )}
      {onlyHere ? (
        <p className="m-0 mt-1 text-body text-muted-foreground">
          Only on this Mac: it is over 10 MB, so it is kept out of sync.
        </p>
      ) : null}
    </>
  );
};

const UrlItemButtons = ({ row, actions }: { row: ItemRowWire; actions: InfoActions }) => (
  <>
    <Button
      variant="ghost"
      size="compact"
      leadingIcon={ArchiveIcon}
      onClick={() => {
        actions.keepCopy(row.path);
      }}
    >
      Keep a copy of the page
    </Button>
    <Button
      variant="ghost"
      size="compact"
      leadingIcon={RefreshCwIcon}
      onClick={(event) => {
        actions.refresh(row.path, event.altKey);
      }}
    >
      Refresh from the page
    </Button>
  </>
);

const ItemButtons = ({ row, actions }: { row: ItemRowWire; actions: InfoActions }) => (
  <div className="px-3 py-2">
    <div className="-ml-2 flex flex-col items-start">
      {row.bare ? null : (
        <Button
          variant="ghost"
          size="compact"
          leadingIcon={row.pinned ? PinOffIcon : PinIcon}
          onClick={() => {
            actions.setPinned(row.path, !row.pinned);
          }}
        >
          {row.pinned ? "Unpin" : "Pin"}
        </Button>
      )}
      {isUrlItem(row) ? <UrlItemButtons row={row} actions={actions} /> : null}
      {actions.reveal === null ? null : (
        <Button
          variant="ghost"
          size="compact"
          leadingIcon={FolderSearchIcon}
          onClick={() => {
            actions.reveal?.(row.file ?? row.path);
          }}
        >
          Reveal in Finder
        </Button>
      )}
      <Button
        variant="ghost"
        size="compact"
        leadingIcon={Trash2Icon}
        className="text-destructive hover:text-destructive"
        onClick={() => {
          actions.remove([row.path]);
        }}
      >
        Delete
      </Button>
    </div>
  </div>
);

const ItemInfo = ({
  row,
  actions,
  onOpenDoc,
}: {
  row: ItemRowWire;
  actions: InfoActions;
  onOpenDoc: (path: string) => void;
}) => {
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const folder = dirnamePath(row.path);
  const savedMs = row.saved === null ? null : parseItemTime(row.saved);
  const doc = !row.bare;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-info-item={row.path}>
      <div className="flex flex-col gap-0.5 px-3 py-2">
        <p className="m-0 truncate pb-1 text-subtitle font-medium text-ink">{row.title}</p>
        <Row label="Kind">
          <span className="flex items-center gap-1">
            {KIND_LABELS[row.kind]} · {folder === "" ? "Library" : folder}
            <Button
              variant="ghost"
              size="compact"
              leadingIcon={FolderInputIcon}
              className="ml-auto"
              onClick={() => {
                actions.move([row.path]);
              }}
            >
              Move…
            </Button>
          </span>
        </Row>
        {isUrlItem(row) || row.url !== null ? <AddressRow row={row} /> : null}
        {row.site === null ? null : <Row label="Site">{row.site}</Row>}
        <Row label="Saved">{dateLabel(savedMs)}</Row>
        <Row label="Modified">{dateLabel(row.modifiedMs)}</Row>
        {doc ? <DocFields row={row} /> : null}
        <ItemNotices row={row} actions={actions} />
      </div>
      {doc ? (
        <>
          <RelatedInline docPath={row.path} onOpenDoc={onOpenDoc} />
          <NoteFacts docPath={row.path} />
          <InlineProperties
            docPath={row.path}
            open={propertiesOpen}
            onOpenChange={setPropertiesOpen}
          />
        </>
      ) : null}
      <ItemButtons row={row} actions={actions} />
    </div>
  );
};

const SelectionInfo = ({ count, actions }: { count: number; actions: InfoActions }) => (
  <div className="flex flex-col gap-1 px-3 py-2">
    <p className="m-0 text-subtitle font-medium text-ink">{plural(count, "item")}</p>
    <div className="-ml-2 flex flex-col items-start">
      <Button
        variant="ghost"
        size="compact"
        leadingIcon={TagIcon}
        onClick={() => {
          actions.withSelection(actions.tag);
        }}
      >
        Tag…
      </Button>
      <Button
        variant="ghost"
        size="compact"
        leadingIcon={FolderInputIcon}
        onClick={() => {
          actions.withSelection(actions.move);
        }}
      >
        Move…
      </Button>
      <Button
        variant="ghost"
        size="compact"
        leadingIcon={MessageSquareIcon}
        onClick={() => {
          actions.withSelection(actions.askAgent);
        }}
      >
        Ask agent
      </Button>
      <Button
        variant="ghost"
        size="compact"
        leadingIcon={Trash2Icon}
        className="text-destructive hover:text-destructive"
        onClick={() => {
          actions.withSelection(actions.remove);
        }}
      >
        Delete
      </Button>
    </div>
  </div>
);

const ScopeInfo = ({ scope, actions }: { scope: LibraryScope; actions: InfoActions }) => {
  const scopes = useLibraryScopes();
  const count = (() => {
    const { data } = scopes;
    if (data === undefined) {
      return null;
    }
    switch (scope.kind) {
      case "all": {
        return data.total;
      }
      case "unsorted": {
        return data.unsorted;
      }
      case "folder": {
        return data.folders.find((folder) => folder.path === scope.path)?.items ?? 0;
      }
      case "tag":
      case "deleted": {
        return null;
      }
      default: {
        const exhaustive: never = scope;
        return exhaustive;
      }
    }
  })();
  return (
    <div className="flex flex-col gap-1 px-3 py-2">
      <p className="m-0 text-subtitle font-medium text-ink">{scopeTitle(scope)}</p>
      {count === null ? null : (
        <p className="m-0 text-body text-muted-foreground">{formatCount(count)} items</p>
      )}
      {scope.kind === "tag" ? (
        <Button
          variant="ghost"
          size="compact"
          className="-ml-2 self-start"
          leadingIcon={PencilIcon}
          onClick={() => {
            actions.onRenameTag(scope.tag);
          }}
        >
          Rename tag…
        </Button>
      ) : null}
      {scope.kind === "folder" ? (
        <Button
          variant="ghost"
          size="compact"
          className="-ml-2 self-start"
          leadingIcon={PencilIcon}
          onClick={() => {
            actions.onRenameFolder(scope.path);
          }}
        >
          Rename folder…
        </Button>
      ) : null}
    </div>
  );
};

export const InfoTab = ({
  subject,
  selectionCount,
  actions,
  onOpenDoc,
}: {
  subject: PanelSubject;
  // how many a selection subject stands for: the scope's total when it is ⌘A
  selectionCount: number;
  actions: InfoActions;
  onOpenDoc: (path: string) => void;
}) => {
  const rowQuery = useItemRow(subject.kind === "item" ? subject.path : null);
  switch (subject.kind) {
    case "item": {
      const row = rowQuery.data ?? null;
      if (row === null) {
        return (
          <p className="p-3 text-subtitle text-muted-foreground">
            {rowQuery.isPending ? "Loading…" : "This isn't in your library."}
          </p>
        );
      }
      return <ItemInfo key={row.path} row={row} actions={actions} onOpenDoc={onOpenDoc} />;
    }
    case "selection": {
      return <SelectionInfo count={selectionCount} actions={actions} />;
    }
    case "scope": {
      return <ScopeInfo scope={subject.scope} actions={actions} />;
    }
    default: {
      const exhaustive: never = subject;
      return exhaustive;
    }
  }
};
