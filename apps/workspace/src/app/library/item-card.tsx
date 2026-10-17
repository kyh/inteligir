// One item as a card. The cover is the index's `cover`, asked of the thumbnail route at the
// grid's width, and the original once if the thumbnail is refused (where `sips` is absent);
// every byte-route url carries the boot's media token. With no cover the card draws a tile for
// its kind. The card only reports gestures: the grid owns the selection, the focus and the menu.

import type { ItemRowWire } from "@repo/contract/local/items/items-schema";
import { vaultAssetUrl, vaultThumbUrl } from "@repo/contract/local/routes";
import { Shimmer } from "@repo/ui/ai/selection-actions";
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
import { FileKindIcon } from "@repo/editor/nodes/file-card";
import { FileTextIcon, MusicIcon, PinIcon, PlayIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent, MouseEvent } from "react";

import type { MediaOrigin } from "../vault-hooks";
import { cardMeta, fileExtensionLabel } from "./item-labels";

export interface ItemCardProps {
  row: ItemRowWire;
  selected: boolean;
  // the one card Tab reaches; the grid's arrows move it
  tabStop: boolean;
  // the keyboard lands here as the card mounts: the grid's focus was moved to it before its
  // window had loaded, or the grid came back from an item
  takeFocus: boolean;
  media: MediaOrigin | null;
  nowMs: number;
  onPress: (row: ItemRowWire, event: MouseEvent<HTMLDivElement>) => void;
  onOpen: (row: ItemRowWire) => void;
  onMenu: (row: ItemRowWire, anchor: HTMLElement) => void;
  onDragStart: (row: ItemRowWire, event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
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

const GlyphTile = ({ row }: { row: ItemRowWire }) => {
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
  const extension = fileExtensionLabel(row.file);
  return (
    <div aria-hidden="true" className="flex size-full flex-col items-center justify-center gap-1">
      <FileKindIcon
        path={row.file ?? row.path}
        className="size-9 text-muted-foreground"
        strokeWidth={1.25}
      />
      {extension === "" ? null : (
        <span className="text-caption font-medium text-muted-foreground">{extension}</span>
      )}
    </div>
  );
};

// the thumbnail first; the original once, where the thumbnail route refuses
const CoverImage = ({ path, media }: { path: string; media: MediaOrigin }) => {
  const [fallback, setFallback] = useState(false);
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
      src={
        fallback
          ? vaultAssetUrl(media.origin, path, media.token)
          : vaultThumbUrl(media.origin, path, 320, media.token)
      }
      onError={() => {
        if (fallback) {
          setFailed(true);
        } else {
          setFallback(true);
        }
      }}
    />
  );
};

const CoverArea = ({ row, media }: { row: ItemRowWire; media: MediaOrigin | null }) => {
  if (row.pending) {
    return (
      <div className="flex size-full items-center justify-center bg-muted/60">
        <Shimmer className="text-body">Filling in…</Shimmer>
      </div>
    );
  }
  if (row.cover !== null && media !== null) {
    return <CoverImage key={row.cover} path={row.cover} media={media} />;
  }
  if (row.kind === "note") {
    return row.preview === "" ? (
      <div aria-hidden="true" className="flex size-full items-center justify-center">
        <FileTextIcon className="size-8 text-muted-foreground/60" strokeWidth={1.25} />
      </div>
    ) : (
      <p className="m-0 line-clamp-6 px-3 py-2.5 text-body break-words text-ink-2">{row.preview}</p>
    );
  }
  if (row.kind === "link") {
    return <MonogramTile label={row.site ?? row.host ?? row.title} />;
  }
  return <GlyphTile row={row} />;
};

export const ItemCard = ({
  row,
  selected,
  tabStop,
  takeFocus,
  media,
  nowMs,
  onPress,
  onOpen,
  onMenu,
  onDragStart,
  onDragEnd,
}: ItemCardProps) => {
  const playable = (row.kind === "video" || row.kind === "audio") && row.cover !== null;
  const cardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (takeFocus) {
      cardRef.current?.focus({ preventScroll: true });
    }
  }, [takeFocus]);
  return (
    <MediaCard
      ref={cardRef}
      selected={selected}
      tabIndex={tabStop ? 0 : -1}
      draggable
      data-item-path={row.path}
      aria-label={row.title}
      onClick={(event) => {
        onPress(row, event);
      }}
      onDoubleClick={() => {
        onOpen(row);
      }}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        // the grid's table binds Enter; a card stands for itself only under a screen reader's
        // own activation, which arrives as a click
        if (event.key === "ContextMenu") {
          event.preventDefault();
          onMenu(row, event.currentTarget);
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(row, event.currentTarget);
      }}
      onDragStart={(event) => {
        onDragStart(row, event);
      }}
      onDragEnd={onDragEnd}
    >
      <MediaCardCover>
        <CoverArea row={row} media={media} />
        {playable ? <MediaCardBadge icon={<PlayIcon />} position="top-right" /> : null}
        {row.pinned ? (
          <MediaCardBadge icon={<PinIcon />} position="top-left" aria-label="Pinned" />
        ) : null}
        {row.fetchError === null ? null : (
          <Tooltip content={row.fetchError} side="top">
            <MediaCardBadge icon={<TriangleAlertIcon />}>Page not read</MediaCardBadge>
          </Tooltip>
        )}
      </MediaCardCover>
      <MediaCardBody>
        <MediaCardTitle>{row.title}</MediaCardTitle>
        <MediaCardMeta>{cardMeta(row, nowMs)}</MediaCardMeta>
        {row.description === null || row.description === "" ? null : (
          <MediaCardDescription>{row.description}</MediaCardDescription>
        )}
      </MediaCardBody>
    </MediaCard>
  );
};
