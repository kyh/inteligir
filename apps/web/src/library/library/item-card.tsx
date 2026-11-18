import { FileKindIcon } from "@repo/editor/nodes/file-card";
import { shownTitle } from "@repo/contract/items/item-name";
import {
  MediaCard,
  MediaCardBadge,
  MediaCardBody,
  MediaCardCover,
  MediaCardDescription,
  MediaCardMeta,
  MediaCardTitle,
} from "@repo/ui/components/media-card";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/components/popover";
import { landedInside } from "@repo/ui/lib/landed-inside";
import { FileTextIcon, MusicIcon, PinIcon, PlayIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";

import { fileUrl } from "../cloud/library-files";
import { cardMeta, coverOf, fileExtensionLabel } from "./item-labels";
import type { ListedItem } from "./listing";

export interface ItemCardProps {
  readonly row: ListedItem;
  readonly selected: boolean;
  readonly tabStop: boolean;
  readonly nowMs: number;
  readonly onPress: (row: ListedItem, event: MouseEvent<HTMLDivElement>) => void;
  readonly onOpen: (row: ListedItem) => void;
  readonly onMenu: (row: ListedItem, anchor: HTMLElement) => void;
}

const hueOf = (text: string) => {
  let hash = 0;

  for (const char of text) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 360;
  }

  return hash;
};

const MonogramTile = ({ label }: { label: string }) => {
  const hue = hueOf(label);

  return (
    <div
      aria-hidden="true"
      className="flex size-full items-center justify-center text-display font-semibold"
      style={{
        backgroundColor: `color-mix(in srgb, hsl(${String(hue)} 55% 50%) 16%, var(--surface))`,
        color: `color-mix(in srgb, hsl(${String(hue)} 55% 40%) 75%, var(--ink))`,
      }}
    >
      {label.slice(0, 1).toLocaleUpperCase()}
    </div>
  );
};

const GlyphTile = ({ row }: { row: ListedItem }) => {
  if (row.fields.kind === "pdf") {
    return (
      <div aria-hidden="true" className="flex size-full items-center justify-center">
        <FileTextIcon className="size-10 text-muted-foreground" strokeWidth={1.25} />
      </div>
    );
  }

  if (row.fields.kind === "video" || row.fields.kind === "audio") {
    return (
      <div aria-hidden="true" className="flex size-full items-center justify-center">
        {row.fields.kind === "video" ? (
          <PlayIcon className="size-10 text-muted-foreground" strokeWidth={1.25} />
        ) : (
          <MusicIcon className="size-10 text-muted-foreground" strokeWidth={1.25} />
        )}
      </div>
    );
  }

  const name = row.fields.originalName ?? row.card.title;
  const extension = fileExtensionLabel(name);

  return (
    <div aria-hidden="true" className="flex size-full flex-col items-center justify-center gap-1">
      <FileKindIcon name={name} className="size-9 text-muted-foreground" strokeWidth={1.25} />
      {extension === "" ? null : (
        <span className="text-caption font-medium text-muted-foreground">{extension}</span>
      )}
    </div>
  );
};

const CoverImage = ({ sha }: { sha: string }) => {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return null;
  }

  return (
    <img
      alt=""
      draggable={false}
      loading="lazy"
      decoding="async"
      src={fileUrl(sha)}
      onError={() => {
        setFailed(true);
      }}
    />
  );
};

const CoverArea = ({ row }: { row: ListedItem }) => {
  if (row.fields.reading.state === "pending") {
    return (
      <div className="flex size-full items-center justify-center bg-muted/60">
        <span className="text-body text-muted-foreground">Not read yet</span>
      </div>
    );
  }

  const cover = coverOf(row);

  if (cover !== null) {
    return <CoverImage key={cover} sha={cover} />;
  }

  if (row.fields.kind === "note") {
    return row.card.preview === "" ? (
      <div aria-hidden="true" className="flex size-full items-center justify-center">
        <FileTextIcon className="size-8 text-muted-foreground/60" strokeWidth={1.25} />
      </div>
    ) : (
      <p className="m-0 line-clamp-6 px-3 py-2.5 text-body break-words text-ink-2">
        {row.card.preview}
      </p>
    );
  }

  if (row.fields.kind === "link") {
    return <MonogramTile label={row.fields.site ?? row.card.title} />;
  }

  return <GlyphTile row={row} />;
};

export const ItemCard = ({
  row,
  selected,
  tabStop,
  nowMs,
  onPress,
  onOpen,
  onMenu,
}: ItemCardProps) => {
  const playable =
    (row.fields.kind === "video" || row.fields.kind === "audio") && row.fields.coverSha !== null;

  const title = shownTitle(row.card.title);
  const { reading } = row.fields;

  return (
    <MediaCard
      selected={selected}
      tabIndex={tabStop ? 0 : -1}
      data-item-id={row.id}
      aria-label={title}
      onClick={(event) => {
        if (!landedInside(event)) {
          return;
        }

        onPress(row, event);

        if (event.detail === 2) {
          onOpen(row);
        }
      }}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (landedInside(event) && event.key === "ContextMenu") {
          event.preventDefault();
          onMenu(row, event.currentTarget);
        }
      }}
      onContextMenu={(event) => {
        if (!landedInside(event)) {
          return;
        }

        event.preventDefault();
        onMenu(row, event.currentTarget);
      }}
    >
      <MediaCardCover>
        <CoverArea row={row} />
        {playable ? <MediaCardBadge icon={<PlayIcon />} position="top-right" /> : null}
        {row.fields.pinnedAt === null ? null : (
          <MediaCardBadge icon={<PinIcon />} position="top-left" aria-label="Pinned" />
        )}
        {reading.state === "failed" ? (
          <Popover>
            <PopoverTrigger
              openOnHover
              nativeButton={false}
              render={<MediaCardBadge icon={<TriangleAlertIcon />} />}
            >
              Page not read
            </PopoverTrigger>
            <PopoverContent side="top" className="w-64 gap-0 rounded-xl p-3 text-body select-text">
              {reading.error}
            </PopoverContent>
          </Popover>
        ) : null}
      </MediaCardCover>
      <MediaCardBody>
        <MediaCardTitle>{title}</MediaCardTitle>
        <MediaCardMeta>{cardMeta(row, nowMs)}</MediaCardMeta>
        {row.fields.description === null ? null : (
          <MediaCardDescription>{row.fields.description}</MediaCardDescription>
        )}
      </MediaCardBody>
    </MediaCard>
  );
};
