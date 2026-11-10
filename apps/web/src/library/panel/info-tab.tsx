// CLAUDE.md § AN ITEM'S INFO IS ITS FIELDS, AND A WRITE SHOWS BEFORE IT LANDS. Info reads the item's
// row as the cell holds it (its fields, its card's counts), read again as either moves, and writes a
// field as one change the cell makes, laid over what the page shows at once, so a pin, a move, a
// tag or a property reads as done before it lands. Every part of it is the cell's, so it waits for
// a connection.

import { refusalText } from "@repo/contract/refusal-text";
import { itemProperties } from "@repo/editor/item/item-properties";
import type { ItemFields } from "@repo/editor/item/item-properties";
import { PropertiesPanel } from "@repo/editor/properties/properties-panel";
import type { PropertyValue } from "@repo/contract/library/library-item";
import { Button } from "@repo/ui/components/button";
import { toast } from "@repo/ui/components/sonner";
import { Switch } from "@repo/ui/components/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { useLibraryQueries, useWire } from "../cloud/library-context";
import { CellAnswer, cellStanding } from "../cloud/needs-connection";
import { formatCount, KIND_LABELS, isUrlItem } from "../library/item-labels";
import { useLibraryVerbs } from "../library/library-verbs";

export interface InfoActions {
  readonly move: (itemId: string) => void;
  // the tags its own field holds, which the dialog offers to take off
  readonly tag: (itemId: string, tags: readonly string[]) => void;
}

const DATE_TIME = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-baseline gap-3 py-1">
    <dt className="w-24 shrink-0 text-caption text-muted-foreground">{label}</dt>
    <dd className="m-0 min-w-0 flex-1 text-body break-words select-text">{children}</dd>
  </div>
);

const folderName = (
  folders: readonly { readonly id: string; readonly name: string }[],
  folderId: string | null,
): string =>
  folderId === null
    ? "Unsorted"
    : (folders.find((folder) => folder.id === folderId)?.name ?? "A folder not here yet");

// a property as one line: its words as they are, anything else as the JSON it holds
const propertyText = (value: PropertyValue): string => {
  const words = z.string().safeParse(value);
  return words.success ? words.data : JSON.stringify(value);
};

// the item's fields as the page's query holds them, and a property's edit written over them
const useItemFields = (itemId: string): ItemFields => {
  const queryClient = useQueryClient();
  const verbs = useLibraryVerbs();
  const { queryKey } = useLibraryQueries().item(itemId);
  return {
    fields: () => queryClient.getQueryData(queryKey)?.fields ?? null,
    subscribe: (listener) =>
      queryClient.getQueryCache().subscribe(() => {
        listener();
      }),
    write: (op) => {
      verbs.writeFields(itemId, [op]);
    },
  };
};

export const InfoTab = ({ itemId, actions }: { itemId: string; actions: InfoActions }) => {
  const queries = useLibraryQueries();
  const verbs = useLibraryVerbs();
  const { orpc } = useWire();
  const item = useQuery(queries.item(itemId));
  const itemFields = useItemFields(itemId);
  const folders = useQuery(queries.scopes()).data?.folders ?? [];
  const refresh = useMutation(
    orpc.library.items.refresh.mutationOptions({
      onError: (cause) => {
        toast.error(refusalText(cause, "The page couldn't be read again."));
      },
      onSuccess: () => {
        toast.success("Reading the page again. Its text lands here soon.");
      },
    }),
  );
  if (cellStanding(item).kind === "missing") {
    return <p className="m-0 p-3 text-body text-muted-foreground">This item isn’t here.</p>;
  }
  return (
    <CellAnswer query={item} failed="This item couldn't be read.">
      {({ id, fields, card }) => (
        <div className="flex flex-col gap-3 p-3" data-info-item={itemId}>
          <dl className="m-0">
            <Row label="Kind">{KIND_LABELS[fields.kind]}</Row>
            {fields.url === null ? null : (
              <Row label="Address">
                <a
                  href={fields.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  {fields.site ?? fields.url}
                </a>
              </Row>
            )}
            {fields.author === null ? null : <Row label="By">{fields.author}</Row>}
            <Row label="Saved">{DATE_TIME.format(fields.savedAt)}</Row>
            <Row label="Words">{formatCount(card.words)}</Row>
            <Row label="Folder">
              <span className="flex items-center gap-2">
                {folderName(folders, fields.folderId)}
                <Button
                  size="compact"
                  variant="ghost"
                  onClick={() => {
                    actions.move(id);
                  }}
                >
                  Move…
                </Button>
              </span>
            </Row>
            <Row label="Tags">
              <span className="flex flex-wrap items-center gap-1.5">
                {fields.tags.map((tag) => (
                  <span key={tag} className="rounded bg-muted px-1.5 text-caption">
                    #{tag}
                  </span>
                ))}
                <Button
                  size="compact"
                  variant="ghost"
                  onClick={() => {
                    actions.tag(id, fields.tags);
                  }}
                >
                  Tag…
                </Button>
              </span>
            </Row>
            {fields.deletedAt === null
              ? null
              : Object.entries(fields.properties).map(([key, value]) => (
                  <Row key={key} label={key}>
                    {value === undefined ? "" : propertyText(value)}
                  </Row>
                ))}
          </dl>
          {fields.deletedAt === null ? (
            <PropertiesPanel source={itemProperties(itemFields)} />
          ) : null}
          <Switch
            label="Pinned"
            checked={fields.pinnedAt !== null}
            onCheckedChange={(pinned) => {
              verbs.pin([id], pinned);
            }}
          />
          {isUrlItem(fields) ? (
            <div className="flex flex-col gap-1.5">
              {fields.fetchState === "failed" && fields.fetchError !== null ? (
                <p className="m-0 text-body text-muted-foreground">{fields.fetchError}</p>
              ) : null}
              <Button
                variant="secondary"
                size="compact"
                disabled={refresh.isPending}
                onClick={() => {
                  refresh.mutate({ id });
                }}
              >
                Read the page again
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </CellAnswer>
  );
};
