// The live wiki-link chip: resolves its target against the vault listing and
// navigates on click. Unresolved targets are visually distinct (dashed) and
// clicking offers to create the note.
//
// Loaded via React.lazy from wiki-link-kit: this module reaches into
// vault-context (and through it the markdown pipeline and base-kit), so an
// eager import from the kit file — which base-kit composes — would close an
// import cycle around the kit files. Same seam as block-list → todo-delegation.

import { useRef, useState, type MouseEvent } from "react";
import { FilePlusIcon } from "lucide-react";

import { Popover, PopoverContent } from "@repo/ui/components/popover";
import { cn } from "@repo/ui/lib/utils";

import { useVault } from "@repo/app/workspace/vault-context";
import { parseWikiBody } from "@repo/features/markdown/remark-wiki-link";

/** Shared chip label: alias wins, else target(+anchor) as written. */
export function wikiChipLabel(body: string): string {
  const parsed = parseWikiBody(body);
  if (parsed.alias) return parsed.alias;
  return parsed.anchor ? `${parsed.target}#${parsed.anchor}` : parsed.target;
}

export const RESOLVED_CHIP_CLASS =
  "cursor-pointer rounded-sm bg-primary/10 px-1 text-primary transition-colors hover:bg-primary/20";
export const UNRESOLVED_CHIP_CLASS =
  "cursor-pointer rounded-sm px-1 text-muted-foreground underline decoration-dashed decoration-muted-foreground/60 underline-offset-2 transition-colors hover:bg-muted";

export default function WikiChip({ body }: { body: string }) {
  const { resolveWikiTarget, openFile, createFile } = useVault();
  const [createOpen, setCreateOpen] = useState(false);
  const chipRef = useRef<HTMLButtonElement>(null);

  const parsed = parseWikiBody(body);
  const label = wikiChipLabel(body);
  // A pure-anchor link (`[[#sec]]`) points at the open note — nothing to
  // resolve or create; render an inert chip.
  const resolved = parsed.target === "" ? null : resolveWikiTarget(parsed.target);

  const onClick = (e: MouseEvent) => {
    e.preventDefault();
    if (parsed.target === "") return;
    if (resolved !== null) {
      openFile(resolved);
      return;
    }
    setCreateOpen(true);
  };

  return (
    <>
      <button
        ref={chipRef}
        type="button"
        contentEditable={false}
        title={
          parsed.target === ""
            ? label
            : (resolved ?? `${parsed.target} — not created yet (click to create)`)
        }
        onClick={onClick}
        className={cn(resolved !== null ? RESOLVED_CHIP_CLASS : UNRESOLVED_CHIP_CLASS)}
      >
        {label}
      </button>
      {resolved === null && parsed.target !== "" && (
        <Popover open={createOpen} onOpenChange={setCreateOpen}>
          <PopoverContent anchor={chipRef} className="p-1">
            <button
              type="button"
              onClick={() => {
                setCreateOpen(false);
                void createFile(parsed.target);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
            >
              <FilePlusIcon className="size-4 text-muted-foreground" />
              <span>
                Create <span className="font-medium">{parsed.target}.md</span>
              </span>
            </button>
          </PopoverContent>
        </Popover>
      )}
    </>
  );
}
