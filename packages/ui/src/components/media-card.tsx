"use client";
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- a card is a cell of the virtualized card grid, a flex column of divs that a <td> would lay out as a table cell */
// A saved thing as a card: a 16:10 cover over a fixed body, so every card in a row is one height
// and the grid that draws them measures nothing (`mediaCardHeight`). The card is a grid cell; the
// grid owns the selection and the focus, and the card only says which it has.

import type { HTMLAttributes, ReactNode, RefAttributes } from "react";

import { cn } from "@repo/ui/lib/cn";

// the body under the cover: two lines of title, a line of meta and two of description, clipped
const MEDIA_CARD_BODY_PX = 92;

export const mediaCardHeight = (cellWidth: number): number =>
  Math.round((cellWidth * 10) / 16) + MEDIA_CARD_BODY_PX;

interface MediaCardProps extends HTMLAttributes<HTMLDivElement> {
  selected?: boolean;
}

const MediaCard = ({
  className,
  selected = false,
  ref,
  ...props
}: MediaCardProps & RefAttributes<HTMLDivElement>) => (
  <div
    ref={ref}
    role="gridcell"
    aria-selected={selected}
    data-slot="media-card"
    data-selected={selected ? "" : undefined}
    className={cn(
      "group/card flex h-full min-w-0 cursor-default flex-col overflow-hidden rounded-lg border border-line bg-surface outline-none select-none",
      "transition-shadow duration-100 hover:shadow-surface-2",
      "focus-visible:ring-2 focus-visible:ring-focus-ring",
      selected && "border-primary/60 ring-2 ring-primary/50",
      className,
    )}
    {...props}
  />
);

const MediaCardCover = ({
  className,
  ref,
  ...props
}: HTMLAttributes<HTMLDivElement> & RefAttributes<HTMLDivElement>) => (
  <div
    ref={ref}
    data-slot="media-card-cover"
    className={cn(
      "relative aspect-[16/10] w-full shrink-0 overflow-hidden bg-muted [&>img]:size-full [&>img]:object-cover",
      className,
    )}
    {...props}
  />
);

const MediaCardBody = ({
  className,
  ref,
  ...props
}: HTMLAttributes<HTMLDivElement> & RefAttributes<HTMLDivElement>) => (
  <div
    ref={ref}
    data-slot="media-card-body"
    className={cn("flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden px-2.5 py-2", className)}
    {...props}
  />
);

const MediaCardTitle = ({
  className,
  ref,
  ...props
}: HTMLAttributes<HTMLParagraphElement> & RefAttributes<HTMLParagraphElement>) => (
  <p
    ref={ref}
    data-slot="media-card-title"
    className={cn("m-0 line-clamp-2 text-subtitle font-medium break-words text-ink", className)}
    {...props}
  />
);

const MediaCardMeta = ({
  className,
  ref,
  ...props
}: HTMLAttributes<HTMLParagraphElement> & RefAttributes<HTMLParagraphElement>) => (
  <p
    ref={ref}
    data-slot="media-card-meta"
    className={cn("m-0 truncate text-caption text-muted-foreground", className)}
    {...props}
  />
);

const MediaCardDescription = ({
  className,
  ref,
  ...props
}: HTMLAttributes<HTMLParagraphElement> & RefAttributes<HTMLParagraphElement>) => (
  <p
    ref={ref}
    data-slot="media-card-description"
    className={cn("m-0 line-clamp-2 text-body text-muted-foreground", className)}
    {...props}
  />
);

// a mark over the cover's corner: a play glyph, or a short word about the item's state
interface MediaCardBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  icon?: ReactNode;
  position?: "top-left" | "top-right" | "bottom-left";
}

const MediaCardBadge = ({
  className,
  icon,
  position = "bottom-left",
  children,
  ref,
  ...props
}: MediaCardBadgeProps & RefAttributes<HTMLSpanElement>) => (
  <span
    ref={ref}
    data-slot="media-card-badge"
    className={cn(
      "absolute flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-caption text-white backdrop-blur-sm [&_svg]:size-3 [&_svg]:shrink-0",
      {
        "bottom-left": "bottom-1.5 left-1.5",
        "top-left": "top-1.5 left-1.5",
        "top-right": "top-1.5 right-1.5",
      }[position],
      className,
    )}
    {...props}
  >
    {icon}
    {children}
  </span>
);

// a cell whose row has not loaded yet: the card's shape, nothing in it to read
const MediaCardSkeleton = ({
  className,
  ref,
  ...props
}: HTMLAttributes<HTMLDivElement> & RefAttributes<HTMLDivElement>) => (
  <div
    ref={ref}
    role="gridcell"
    aria-busy
    data-slot="media-card-skeleton"
    className={cn(
      "flex h-full min-w-0 flex-col overflow-hidden rounded-lg border border-line",
      className,
    )}
    {...props}
  >
    <div className="aspect-[16/10] w-full shrink-0 animate-pulse bg-muted" />
    <div className="flex flex-col gap-1.5 px-2.5 py-2.5">
      <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
      <div className="h-2.5 w-1/2 animate-pulse rounded bg-muted" />
    </div>
  </div>
);

export {
  MediaCard,
  MediaCardBadge,
  MediaCardBody,
  MediaCardCover,
  MediaCardDescription,
  MediaCardMeta,
  MediaCardSkeleton,
  MediaCardTitle,
};
