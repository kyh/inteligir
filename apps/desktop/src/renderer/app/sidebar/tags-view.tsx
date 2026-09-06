import type { TagCountWire } from "@repo/api/local/knowledge/knowledge-schema";
import { isTagName } from "@repo/notes/knowledge/link-extract";
import { Button } from "@repo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import { Input } from "@repo/ui/components/input";
import { toast } from "@repo/ui/components/sonner";
import { plural } from "@repo/ui/lib/plural";
import { cn } from "@repo/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, ChevronRightIcon, PencilIcon } from "lucide-react";
import { useState } from "react";

import { orpc, refusalMessage } from "../api";

export interface TagNode {
  tag: string;
  name: string;
  // the tag's own uses, and its family's: a folded parent row shows the family
  count: number;
  total: number;
  children: TagNode[];
}

function byTotal(a: TagNode, b: TagNode): number {
  return b.total - a.total || a.name.localeCompare(b.name);
}

// folded by `/`: every level gets a row, whether or not a note uses it bare
export function foldTags(tags: readonly TagCountWire[]): TagNode[] {
  const roots: TagNode[] = [];
  const byTag = new Map<string, TagNode>();
  const nodeFor = (tag: string): TagNode => {
    const existing = byTag.get(tag);
    if (existing !== undefined) return existing;
    const slash = tag.lastIndexOf("/");
    const node: TagNode = {
      tag,
      name: slash === -1 ? tag : tag.slice(slash + 1),
      count: 0,
      total: 0,
      children: [],
    };
    byTag.set(tag, node);
    (slash === -1 ? roots : nodeFor(tag.slice(0, slash)).children).push(node);
    return node;
  };
  for (const { tag, count } of tags) nodeFor(tag).count = count;
  const settle = (node: TagNode): TagNode => {
    const children = node.children.map(settle).toSorted(byTotal);
    const total = node.count + children.reduce((sum, child) => sum + child.total, 0);
    return { ...node, children, total };
  };
  return roots.map(settle).toSorted(byTotal);
}

export function TagsView({
  tags,
  loaded,
  onSelect,
  onRename,
}: {
  tags: readonly TagCountWire[];
  loaded: boolean;
  onSelect: (tag: string) => void;
  onRename: (tag: string) => void;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const roots = foldTags(tags);
  if (loaded && roots.length === 0) {
    return (
      <p className="px-3 py-2 text-sm text-muted-foreground">No tags yet. Type #tag in a note.</p>
    );
  }
  const rows: Array<{ node: TagNode; depth: number }> = [];
  const collect = (nodes: readonly TagNode[], depth: number): void => {
    for (const node of nodes) {
      rows.push({ node, depth });
      if (expanded.has(node.tag)) collect(node.children, depth + 1);
    }
  };
  collect(roots, 0);
  const toggle = (tag: string): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  };
  return (
    <div role="list" aria-label="Tags" className="flex flex-col py-1">
      {rows.map(({ node, depth }) => {
        const isExpanded = expanded.has(node.tag);
        return (
          <div
            key={node.tag}
            role="listitem"
            className="group flex w-full items-center gap-1 py-1 pr-1 text-sm hover:bg-muted/60"
            style={{ paddingLeft: depth * 12 + 4 }}
          >
            {node.children.length > 0 ? (
              <Button
                variant="ghost"
                size="icon-compact"
                className="size-5"
                aria-label={isExpanded ? `Collapse ${node.tag}` : `Expand ${node.tag}`}
                onClick={() => {
                  toggle(node.tag);
                }}
              >
                <ChevronRightIcon
                  className={cn("size-3.5 transition-transform", isExpanded && "rotate-90")}
                />
              </Button>
            ) : (
              <span className="w-[18px] shrink-0" />
            )}
            <button
              type="button"
              title={`#${node.tag}`}
              className="min-w-0 flex-1 truncate text-left"
              onClick={() => {
                onSelect(node.tag);
              }}
            >
              #{node.name}
            </button>
            <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
              {node.total}
            </span>
            <Button
              variant="ghost"
              size="icon-compact"
              className="size-5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              aria-label={`Rename ${node.tag}`}
              onClick={() => {
                onRename(node.tag);
              }}
            >
              <PencilIcon className="size-3.5" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}

export interface TagScopeCount {
  // how many of the family the listing holds, and how many there are
  listed: number;
  total: number;
}

// the count says when the list is cut, so a cut is never mistaken for the whole
export function tagScopeCountLabel({ listed, total }: TagScopeCount): string {
  return listed < total ? `${String(listed)} of ${String(total)}` : String(total);
}

export function TagScopeHeader({
  tag,
  count,
  onClear,
  onRename,
}: {
  tag: string;
  count: TagScopeCount | undefined;
  onClear: () => void;
  onRename: () => void;
}) {
  return (
    <div className="flex items-center gap-1 px-1.5 py-1">
      <Button variant="ghost" size="icon-compact" aria-label="All tags" onClick={onClear}>
        <ArrowLeftIcon />
      </Button>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">#{tag}</span>
      {count === undefined ? null : (
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
          {tagScopeCountLabel(count)}
        </span>
      )}
      <Button variant="ghost" size="icon-compact" aria-label={`Rename ${tag}`} onClick={onRename}>
        <PencilIcon />
      </Button>
    </div>
  );
}

export function RenameTagDialog({
  tag,
  onOpenChange,
  onRenamed,
}: {
  tag: string | null;
  onOpenChange: (open: boolean) => void;
  onRenamed: (from: string, to: string) => void;
}) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState("");
  // seeded during render, so the field never paints the previous tag's text
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (openedFor !== tag) {
    setOpenedFor(tag);
    setValue(tag ?? "");
  }
  const rename = useMutation(
    orpc.knowledge.renameTag.mutationOptions({
      onSuccess: (body) => {
        const count = body.rewritten.length;
        toast.success(`Renamed #${body.from} to #${body.to} in ${plural(count, "note")}.`);
        if (body.skipped.length > 0) {
          toast.warning(
            `Skipped ${body.skipped.map((skip) => skip.path).join(", ")}: changed while renaming.`,
          );
        }
        void queryClient.invalidateQueries({ queryKey: orpc.knowledge.key() });
        onOpenChange(false);
        onRenamed(body.from, body.to);
      },
      onError: (cause) => {
        toast.error(refusalMessage(cause, "Could not rename the tag."));
      },
    }),
  );
  const next = value.trim().replace(/^#/u, "");
  const valid = tag !== null && isTagName(next) && next !== tag;
  return (
    <Dialog open={tag !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename tag</DialogTitle>
          <DialogDescription>
            Every note holding #{tag} is rewritten, nested tags included. A note that changes
            mid-rename is skipped, never overwritten.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && tag !== null) rename.mutate({ from: tag, to: next });
          }}
        >
          <Input
            aria-label="New tag name"
            autoFocus
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
            }}
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="tertiary"
              size="compact"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" size="compact" disabled={!valid || rename.isPending}>
              Rename
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
