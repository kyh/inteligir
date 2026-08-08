// Property writes ride the live editor's frontmatter node, so they take the
// same serialize path to disk a body edit does (properties-node.ts).

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { InfoIcon } from "lucide-react";

import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@repo/ui/components/sheet";

import type { VaultFileFacts } from "@repo/bridge/vault";
import { projectDoc } from "@repo/notes/knowledge/projection";
import { basenamePath } from "@repo/notes/knowledge/vault-path";
import { splitFrontmatter } from "@repo/notes/markdown/frontmatter";

import { getLiveEditor } from "@repo/editor/live-editor";
import { PropertiesPanel } from "@repo/editor/properties/properties-panel";
import { getBridge } from "@repo/bridge/client";
import { useOpenNote } from "@repo/editor/note/open-note-store";

/** `file: null` is a note that could not be stat'd — never saved, or moved out
 * from under us. */
type IndexedFacts = {
  backlinks: number;
  forwardLinks: number;
  /** Counted, never dropped — omitting these would disagree with the Links
   * panel. */
  danglingLinks: number;
  file: VaultFileFacts | null;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

function formatModified(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Deliberately naive: a segmenter would disagree with every other editor's
 * count for no reader benefit. */
function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] items-baseline gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 text-xs break-words text-foreground">{children}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** The editor lookup can only miss during a teardown race; the derived facts
 * never needed it and still render. */
export function PageDetails({ path }: { path: string }) {
  const [open, setOpen] = useState(false);
  const editor = open ? getLiveEditor(path) : null;

  // Collapsing to "" while closed keeps a keystroke from re-rendering this.
  const content = useOpenNote((s) => (open ? s.editor.content : ""));

  // The index's own projection, over the live buffer so counts include unsaved
  // edits.
  const projection = useMemo(() => projectDoc(path, content), [path, content]);
  const body = useMemo(() => splitFrontmatter(content).body, [content]);

  const [facts, setFacts] = useState<IndexedFacts | null>(null);
  useEffect(() => {
    if (!open) return;
    const bridge = getBridge();
    const refresh = () => {
      void Promise.all([
        bridge.getBacklinks({ path }),
        bridge.getForwardLinks({ path }),
        bridge.getVaultFileFacts({ path }),
      ])
        .then(([backlinks, forward, file]) =>
          setFacts({
            backlinks: backlinks.length,
            forwardLinks: forward.length,
            danglingLinks: forward.filter((entry) => entry.targetPath === null).length,
            file,
          }),
        )
        .catch(() => {});
    };
    refresh();
    return bridge.onKnowledgeUpdated(refresh);
  }, [open, path]);

  const doneTasks = projection.tasks.filter((task) => task.checked).length;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-label="Page details"
            title="Page details"
            className="size-7 px-0 text-muted-foreground hover:text-foreground"
          />
        }
      >
        <InfoIcon className="size-4" />
      </SheetTrigger>
      <SheetContent
        side="right"
        // Prefixed to match SheetContent's own `data-[side=right]:sm:max-w-sm`:
        // tailwind-merge only dedupes within an identical variant chain.
        className="data-[side=right]:w-[30rem] data-[side=right]:sm:max-w-[92vw]"
      >
        <SheetHeader className="border-b border-border pr-12">
          <SheetTitle>Page details</SheetTitle>
          <SheetDescription className="truncate text-xs" title={path}>
            {basenamePath(path)}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4">
          <Section title="Properties">
            {editor !== null && <PropertiesPanel editor={editor} />}
          </Section>

          <Section title="File">
            <Fact label="Name">{basenamePath(path)}</Fact>
            <Fact label="Path">{path}</Fact>
            <Fact label="Size">{facts?.file ? formatBytes(facts.file.sizeBytes) : "—"}</Fact>
            <Fact label="Modified">
              {facts?.file ? formatModified(facts.file.modifiedMs) : "—"}
            </Fact>
          </Section>

          <Section title="Content">
            <Fact label="Words">{countWords(body).toLocaleString()}</Fact>
            <Fact label="Characters">{body.length.toLocaleString()}</Fact>
            <Fact label="Headings">{projection.headings.length}</Fact>
            <Fact label="Tasks">
              {projection.tasks.length === 0
                ? "0"
                : `${doneTasks} of ${projection.tasks.length} done`}
            </Fact>
          </Section>

          <Section title="Links">
            <Fact label="Backlinks">{facts === null ? "—" : facts.backlinks}</Fact>
            <Fact label="Outgoing">
              {facts === null
                ? "—"
                : facts.danglingLinks === 0
                  ? facts.forwardLinks
                  : `${facts.forwardLinks} (${facts.danglingLinks} unresolved)`}
            </Fact>
          </Section>

          <Section title="Tags">
            {projection.tags.length === 0 ? (
              <span className="text-xs text-muted-foreground">No tags</span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {projection.tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-muted-foreground">
                    #{tag}
                  </Badge>
                ))}
              </div>
            )}
          </Section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
