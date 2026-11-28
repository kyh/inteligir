import { KIND_LABELS } from "@repo/client/library-labels";
import { shownTitle } from "@repo/contract/items/item-name";
import type { Reading } from "@repo/contract/library/item-reading";
import type { PropertyValue } from "@repo/contract/library/library-item";
import { Button } from "@repo/ui/components/button";
import { Switch } from "@repo/ui/components/switch";
import { formatCount } from "@repo/ui/lib/plural";
import { useIsMutating, useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { useLibraryQueries, useLibraryWrites, usePageLibrary } from "../cloud/library-context";
import { CellAnswer, cellStanding } from "../cloud/needs-connection";
import { isUrlItem, readsFileText } from "../library/item-labels";
import { useLibraryCommands } from "../library/library-commands";
import { folderPaths } from "../library/folder-paths";
import { PropertiesPanel } from "./properties-panel";

const DATE_TIME = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-baseline gap-3 py-1">
    <dt className="w-24 shrink-0 text-caption text-muted-foreground">{label}</dt>
    <dd className="m-0 min-w-0 flex-1 text-body break-words select-text">{children}</dd>
  </div>
);

const Related = ({ id }: { readonly id: string }) => {
  const commands = useLibraryCommands();
  const near = useQuery(useLibraryQueries().related(id)).data?.items ?? [];

  if (near.length === 0) {
    return null;
  }

  return (
    <section aria-label="Related" className="flex flex-col gap-1">
      <h3 className="m-0 text-caption text-muted-foreground">Related</h3>
      <ul className="m-0 flex list-none flex-col p-0">
        {near.map((row) => (
          <li key={row.id}>
            <Button
              variant="ghost"
              className="h-auto w-full justify-start py-1 text-left whitespace-normal"
              onClick={() => {
                commands.openItem(row.id);
              }}
            >
              {shownTitle(row.card.title)}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
};

const ReadFailure = ({ reading }: { reading: Reading }) =>
  reading.state === "failed" ? (
    <p className="m-0 text-body text-muted-foreground">{reading.error}</p>
  ) : null;

const ParentName = ({ parentId }: { readonly parentId: string | null }) => {
  const queries = useLibraryQueries();
  const containers = useQuery(queries.scopes()).data?.containers ?? [];
  const paths = new Map(folderPaths(containers).map((row) => [row.id, row.label]));
  const held = parentId === null ? undefined : paths.get(parentId);
  const asked = parentId !== null && held === undefined;

  const read = useQuery({
    ...queries.item(parentId ?? ""),
    enabled: asked,
  });

  const parent = read.data;

  if (parentId === null) {
    return "Unsorted";
  }

  if (held !== undefined) {
    return held;
  }

  if (parent === undefined || parent.fields.deletedAt !== null) {
    return asked && parent === undefined && !read.isError ? "…" : "Unsorted";
  }

  const above = parent.fields.parentId === null ? undefined : paths.get(parent.fields.parentId);
  const title = parent.card.title === "" ? "Untitled" : parent.card.title;

  return above === undefined ? title : `${above} / ${title}`;
};

const propertyText = (value: PropertyValue) => {
  const words = z.string().safeParse(value);

  return words.success ? words.data : JSON.stringify(value);
};

export const InfoTab = ({ itemId }: { itemId: string }) => {
  const commands = useLibraryCommands();
  const queries = useLibraryQueries();
  const writes = useLibraryWrites();
  const pin = useMutation(writes.organize("That couldn't be pinned."));
  const writeFields = useMutation(writes.writeFields());
  const refresh = useMutation(writes.refresh());
  const { orpc } = usePageLibrary().wire;
  const item = useQuery(queries.item(itemId));
  const refreshing = useIsMutating({ mutationKey: orpc.library.items.refresh.mutationKey() }) > 0;

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
                <ParentName parentId={fields.parentId} />
                <Button
                  variant="ghost"
                  onClick={() => {
                    commands.move({ ids: [id], kind: "ids" });
                  }}
                >
                  Move…
                </Button>
              </span>
            </Row>
            {fields.description === null ? null : (
              <Row label="About">
                <span className="select-text">{fields.description}</span>
              </Row>
            )}
            <Row label="Tags">
              <span className="flex flex-wrap items-center gap-1.5">
                {fields.tags.map((tag) => (
                  <span key={tag} className="rounded bg-muted px-1.5 text-caption">
                    #{tag}
                  </span>
                ))}
                <Button
                  variant="ghost"
                  onClick={() => {
                    commands.tag({ ids: [id], kind: "ids" }, [fields.tags]);
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
            <PropertiesPanel
              key={id}
              properties={fields.properties}
              onWrite={(op) => {
                writeFields.mutate({ itemId: id, opId: crypto.randomUUID(), ops: [op] });
              }}
            />
          ) : null}
          <Switch
            label="Pinned"
            checked={fields.pinnedAt !== null}
            onCheckedChange={(pinned) => {
              pin.mutate({ ids: [id], pinned });
            }}
          />
          {isUrlItem(fields) ? (
            <div className="flex flex-col gap-1.5">
              <ReadFailure reading={fields.reading} />
              <Button
                variant="secondary"
                disabled={refreshing}
                onClick={() => {
                  refresh.mutate({ id });
                }}
              >
                Read the page again
              </Button>
            </div>
          ) : null}
          {readsFileText(fields) ? (
            <Button
              variant="secondary"
              disabled={refreshing}
              onClick={() => {
                refresh.mutate({ id });
              }}
            >
              Read the text again
            </Button>
          ) : null}
          {fields.deletedAt === null ? <Related id={id} /> : null}
        </div>
      )}
    </CellAnswer>
  );
};
