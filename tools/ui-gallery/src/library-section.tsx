// Library: the grid of saved things, its cards in every state, the chips that narrow it, and the
// strip that acts on a selection.

import {
  SelectionAction,
  SelectionActions,
  SelectionActionsSeparator,
  Shimmer,
} from "@repo/ui/ai/selection-actions";
import { CardGrid } from "@repo/ui/components/card-grid";
import {
  MediaCard,
  MediaCardBadge,
  MediaCardBody,
  MediaCardCover,
  MediaCardDescription,
  MediaCardMeta,
  MediaCardSkeleton,
  MediaCardTitle,
  mediaCardHeight,
} from "@repo/ui/components/media-card";
import { ToggleChip, ToggleGroup } from "@repo/ui/components/toggle-group";
import { FileTextIcon, PlayIcon } from "lucide-react";
import { useState } from "react";

import { Demo, GallerySection } from "./gallery-chrome";

const SAMPLES = [
  {
    description:
      "If you want to create digital artifacts that last, they must be files you can control.",
    meta: "stephango.com · 3d · #craft",
    title: "File over app",
  },
  { description: "", meta: "PDF · 1.2 MB", title: "Lecture notes" },
  {
    description: "A talk on local-first software.",
    meta: "YouTube · 1w",
    title: "Local-first, ten years on",
  },
] as const;

const KINDS = ["all", "links", "pdfs", "notes"] as const;
type KindChip = (typeof KINDS)[number];
const KIND_LABELS = {
  all: "Everything",
  links: "Links",
  notes: "Notes",
  pdfs: "PDFs",
} satisfies Record<KindChip, string>;

const SampleCard = ({ index, selected }: { index: number; selected: boolean }) => {
  const sample = SAMPLES[index % SAMPLES.length] ?? SAMPLES[0];
  return (
    <MediaCard selected={selected} tabIndex={-1}>
      <MediaCardCover className="flex items-center justify-center text-display text-muted-foreground">
        {sample.title.charAt(0)}
        {index % 3 === 2 ? <MediaCardBadge icon={<PlayIcon />} position="top-right" /> : null}
      </MediaCardCover>
      <MediaCardBody>
        <MediaCardTitle>{sample.title}</MediaCardTitle>
        <MediaCardMeta>{sample.meta}</MediaCardMeta>
        {sample.description === "" ? null : (
          <MediaCardDescription>{sample.description}</MediaCardDescription>
        )}
      </MediaCardBody>
    </MediaCard>
  );
};

export const LibrarySection = () => {
  const [kind, setKind] = useState<KindChip>("all");
  return (
    <GallerySection id="library" title="Library">
      <Demo
        name="CardGrid"
        purpose="Hundreds of cards in uniform rows, only the visible ones mounted; resize and the columns follow."
      >
        <div className="flex h-96 w-full flex-col rounded-md border border-line">
          <CardGrid
            aria-label="Sample library"
            count={500}
            minCellWidth={180}
            cellHeight={mediaCardHeight}
            renderCell={(index) =>
              index % 17 === 5 ? (
                <MediaCardSkeleton />
              ) : (
                <SampleCard index={index} selected={index === 1} />
              )
            }
          />
        </div>
      </Demo>

      <Demo
        name="MediaCard · MediaCardBadge · MediaCardSkeleton"
        purpose="One saved thing: a cover, its title, where it came from and a line of what it says."
      >
        <div className="grid w-full grid-cols-3 gap-4">
          <div style={{ height: mediaCardHeight(200) }}>
            <SampleCard index={0} selected={false} />
          </div>
          <div style={{ height: mediaCardHeight(200) }}>
            <MediaCard selected>
              <MediaCardCover className="flex items-center justify-center text-muted-foreground">
                <FileTextIcon className="size-8" />
                <MediaCardBadge>Page not read</MediaCardBadge>
              </MediaCardCover>
              <MediaCardBody>
                <MediaCardTitle>Lecture notes</MediaCardTitle>
                <MediaCardMeta>PDF · 1.2 MB</MediaCardMeta>
              </MediaCardBody>
            </MediaCard>
          </div>
          <div style={{ height: mediaCardHeight(200) }}>
            <MediaCardSkeleton />
          </div>
        </div>
      </Demo>

      <Demo
        name="ToggleGroup · ToggleChip"
        purpose="One choice from a row of chips, arrows moving between them."
      >
        <ToggleGroup<KindChip>
          aria-label="Kind"
          value={[kind]}
          onValueChange={(next) => {
            setKind(next[0] ?? "all");
          }}
        >
          {KINDS.map((name) => (
            <ToggleChip key={name} value={name}>
              {KIND_LABELS[name]}
            </ToggleChip>
          ))}
        </ToggleGroup>
      </Demo>

      <Demo
        name="SelectionActions · Shimmer"
        purpose="The bar over a selection of items, and the shimmer a line wears while it fills in."
        stack
      >
        <SelectionActions>
          <SelectionAction>Tag…</SelectionAction>
          <SelectionAction>Move…</SelectionAction>
          <SelectionActionsSeparator />
          <SelectionAction hasMenu>Ask agent</SelectionAction>
        </SelectionActions>
        <Shimmer className="text-body">Filling in…</Shimmer>
      </Demo>
    </GallerySection>
  );
};
