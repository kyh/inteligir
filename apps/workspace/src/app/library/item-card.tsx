// One item as a card: its cover from the library's files (`/v1/blobs/<sha>`, which the session
// cookie reads as the wire does), else a tile for its kind; a note shows its first paragraph. The
// card only reports gestures: the grid owns the selection, the focus and the menu.

import { V1_BLOBS_PATH } from "@repo/contract/cloud/library/library-blobs";
import { FileKindIcon } from "@repo/editor/nodes/file-card";
import type { ReplicaListingRow } from "@repo/library-replica/library-replica";
import {
  MediaCard,
  MediaCardBadge,
  MediaCardBody,
  MediaCardCover,
  MediaCardDescription,
  MediaCardMeta,
  MediaCardTitle,
} from "@repo/ui/components/media-card";
import { Tooltip } from "@repo/ui/components/tooltip";
import {
  CloudUploadIcon,
  FileTextIcon,
  MusicIcon,
  PinIcon,
  PlayIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";

import { cardMeta, fileExtensionLabel } from "./item-labels";

export const blobUrl = (sha: string): string => `${V1_BLOBS_PATH}/${sha}`;

export interface ItemCardProps {
  readonly row: ReplicaListingRow;
  readonly selected: boolean;
  // the one card Tab reaches; the grid's arrows move it
  readonly tabStop: boolean;
  readonly nowMs: number;
  readonly onPress: (row: ReplicaListingRow, event: MouseEvent<HTMLDivElement>) => void;
  readonly onOpen: (row: ReplicaListingRow) => void;
  readonly onMenu: (row: ReplicaListingRow, anchor: HTMLElement) => void;
}

const hueOf = (text: string): number => {
  let hash = 0;
  for (const char of text) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 360;
  }
  return hash;
};

// a site's initial on a tile tinted by its name, so one site's cards read as one
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

const GlyphTile = ({ row }: { row: ReplicaListingRow }) => {
  if (row.kind === "pdf") {
    return (
      <div aria-hidden="true" className="flex size-full items-center justify-center">
        <FileTextIcon className="size-10 text-muted-foreground" strokeWidth={1.25} />
      </div>
    );
  }
  if (row.kind === "video" || row.kind === "audio") {
    return (
      <div aria-hidden="true" className="flex size-full items-center justify-center">
        {row.kind === "video" ? (
          <PlayIcon className="size-10 text-muted-foreground" strokeWidth={1.25} />
        ) : (
          <MusicIcon className="size-10 text-muted-foreground" strokeWidth={1.25} />
        )}
      </div>
    );
  }
  const name = row.fields.originalName ?? row.title;
  const extension = fileExtensionLabel(name);
  return (
    <div aria-hidden="true" className="flex size-full flex-col items-center justify-center gap-1">
      <FileKindIcon path={name} className="size-9 text-muted-foreground" strokeWidth={1.25} />
      {extension === "" ? null : (
        <span className="text-caption font-medium text-muted-foreground">{extension}</span>
      )}
    </div>
  );
};

// the cover, or nothing once the library could not answer it
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
      src={blobUrl(sha)}
      onError={() => {
        setFailed(true);
      }}
    />
  );
};

const coverOf = (row: ReplicaListingRow): string | null =>
  row.fields.coverSha ?? (row.kind === "image" ? row.fields.originalSha : null);

const CoverArea = ({ row }: { row: ReplicaListingRow }) => {
  if (row.fields.fetchState === "pending") {
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
  if (row.kind === "note") {
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
  if (row.kind === "link") {
    return <MonogramTile label={row.fields.site ?? row.title} />;
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
  const playable = (row.kind === "video" || row.kind === "audio") && row.fields.coverSha !== null;
  return (
    <MediaCard
      selected={selected}
      tabIndex={tabStop ? 0 : -1}
      data-item-id={row.id}
      aria-label={row.title}
      onClick={(event) => {
        onPress(row, event);
        // a double-click opens on its second click, never on the `dblclick` after it: the click
        // before it can have re-rendered this card into a new element, where the `dblclick` lands
        // on a detached one that reaches no handler
        if (event.detail === 2) {
          onOpen(row);
        }
      }}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "ContextMenu") {
          event.preventDefault();
          onMenu(row, event.currentTarget);
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(row, event.currentTarget);
      }}
    >
      <MediaCardCover>
        <CoverArea row={row} />
        {playable ? <MediaCardBadge icon={<PlayIcon />} position="top-right" /> : null}
        {row.pinnedAt === null ? null : (
          <MediaCardBadge icon={<PinIcon />} position="top-left" aria-label="Pinned" />
        )}
        {row.unsent ? (
          <MediaCardBadge
            icon={<CloudUploadIcon />}
            position="top-right"
            aria-label="Not sent yet"
          />
        ) : null}
        {row.fields.fetchError === null ? null : (
          <Tooltip content={row.fields.fetchError} side="top">
            <MediaCardBadge icon={<TriangleAlertIcon />}>Page not read</MediaCardBadge>
          </Tooltip>
        )}
      </MediaCardCover>
      <MediaCardBody>
        <MediaCardTitle>{row.title}</MediaCardTitle>
        <MediaCardMeta>{cardMeta(row, nowMs)}</MediaCardMeta>
        {row.fields.description === null ? null : (
          <MediaCardDescription>{row.fields.description}</MediaCardDescription>
        )}
      </MediaCardBody>
    </MediaCard>
  );
};
