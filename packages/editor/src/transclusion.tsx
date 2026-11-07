// loaded via React.lazy from wiki-link-kit: this module reaches the editor host seam, so an
// eager import from a kit file base-kit composes would close an import cycle.

import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import type { TElement } from "platejs";

import { cn } from "@repo/ui/lib/cn";

import { useLinkResolver } from "@repo/editor/host";
import { getEditorHostIo } from "@repo/editor/host-io";
import { useOpenItemId } from "@repo/editor/open-item";
import { EmbedChip, StaticNote } from "@repo/editor/static-note";
import { decideTransclusion, embeddedPart, EMBED_PART_GONE } from "@repo/editor/transclusion-guard";
import { wikiLabelOf } from "@repo/editor/wiki/wiki-node";
import type { WikiNodeFields } from "@repo/editor/wiki/wiki-node";

type TargetContent =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "ready"; blocks: readonly TElement[] };

// the embedded item's blocks as this device holds them, read again when that item moves: only
// then, or an embedding item would read every embed on each of its own keystrokes
const useTargetContent = (itemId: string | null): TargetContent => {
  const [state, setState] = useState<TargetContent>({ status: "loading" });
  useEffect(() => {
    if (itemId === null) {
      return;
    }
    const io = getEditorHostIo();
    let live = true;
    const read = async (): Promise<void> => {
      try {
        const blocks = await io.readItemBlocks(itemId);
        if (live) {
          setState(
            blocks === null
              ? { status: "missing" }
              : { blocks: blocks.map((block) => ({ ...block })), status: "ready" },
          );
        }
      } catch {
        if (live) {
          setState({ status: "missing" });
        }
      }
    };
    void read();
    const unsubscribe = io.onItemsChanged((ids) => {
      if (ids === null || ids.has(itemId)) {
        void read();
      }
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [itemId]);
  return state;
};

const EmbeddedBlocks = ({
  blocks,
  link,
}: {
  blocks: readonly TElement[];
  link: WikiNodeFields;
}) => {
  const part = embeddedPart(blocks, link);
  return part === null ? (
    <span className="text-muted-foreground italic">{EMBED_PART_GONE}</span>
  ) : (
    <StaticNote blocks={part} />
  );
};

const Transclusion = ({ link }: { link: WikiNodeFields }) => {
  const { resolveWikiTarget, titleOf } = useLinkResolver();
  const openItemId = useOpenItemId();
  const resolved =
    link.title === "" ? null : resolveWikiTarget(link.title, link.itemId ?? link.alias);
  const decision = decideTransclusion(openItemId, resolved);
  const content = useTargetContent(decision.kind === "render" ? decision.itemId : null);

  if (decision.kind === "chip") {
    return <EmbedChip link={link} note={decision.reason === "cycle" ? "circular" : undefined} />;
  }
  if (content.status === "missing") {
    return <EmbedChip link={link} />;
  }

  const target = decision.itemId;
  const live = titleOf(target);
  const title = wikiLabelOf(live === null ? link : { ...link, title: live });
  const onOpen = (e: MouseEvent) => {
    e.preventDefault();
    getEditorHostIo().openItem(target);
  };

  return (
    <span
      contentEditable={false}
      className={cn(
        "my-1 inline-block w-full rounded-md border border-border bg-muted/30 align-top",
      )}
    >
      <span className="flex items-center border-b border-border/60 px-3 py-1">
        <button
          type="button"
          onClick={onOpen}
          className="cursor-pointer truncate text-body font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          {title}
        </button>
      </span>
      <span className="block overflow-x-auto px-3 py-2">
        {content.status === "loading" ? (
          <span className="text-muted-foreground italic">Loading…</span>
        ) : (
          <EmbeddedBlocks blocks={content.blocks} link={link} />
        )}
      </span>
    </span>
  );
};

export default Transclusion;
