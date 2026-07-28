// "Page details" — the shell-header affordance hosting everything the app
// knows about the open note: the editable frontmatter properties (primary) and
// the derived, read-only facts about the file (secondary).
//
// A RIGHT-edge drawer. The trigger lives in the top-right header and a
// properties surface reads as a right rail, so the panel arrives from the edge
// it was summoned at; the editor column stays where it was instead of being
// covered by a centered dialog. The width is the point of the drawer — the
// property rows are a two-column grid that a narrow floating surface squeezes.
//
// The live rich editor is resolved at OPEN time (live-editor.ts); the panel
// inside edits the frontmatter NODE through that instance, so property writes
// ride the editor's normal serialize path to disk (see properties-node.ts).
//
// The derived facts come from the SAME data path the Links/Backlinks panels
// use — one fetch on open plus onKnowledgeUpdated — so there is no second
// notion of what this note links to. The index lags a save by ~200-300ms,
// which is fine for a panel of counts.

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { InfoIcon } from "lucide-react";

import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@repo/ui/components/drawer";

import type { VaultFileFacts } from "@repo/bridge/ipc-registry";
import { projectDoc } from "@repo/notes/knowledge/projection";
import { basenamePath } from "@repo/notes/knowledge/vault-path";
import { splitFrontmatter } from "@repo/notes/markdown/frontmatter";

import { getLiveEditor } from "@renderer/editor/live-editor";
import { PropertiesPanel } from "@renderer/editor/properties/properties-panel";
import { getBridge } from "@renderer/lib/bridge";
import { useOpenNote } from "@renderer/workspace/open-note-store";

/** The host-answered half of the facts: link counts off the knowledge index,
 * plus the one thing no index carries (size + mtime). `file: null` is a note
 * that could not be stat'd — never saved, or moved out from under us. */
type IndexedFacts = {
  backlinks: number;
  forwardLinks: number;
  /** Forward links with no resolved target. Counted, never dropped: a dangling
   * link is a fact about the page, and silently omitting it would make the
   * total disagree with the Links panel. */
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

/** Whitespace-run word count. Deliberately naive — this is a writing-progress
 * number, not a billing one, and a segmenter would disagree with every other
 * editor's count for no reader benefit. */
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

/** The header renders this only while the rich editor is mounted, so the
 * live-editor lookup can only miss during a teardown race — then the properties
 * section renders empty and the derived facts, which never needed the editor,
 * still show. */
export function PageDetails({ path }: { path: string }) {
  const [open, setOpen] = useState(false);
  const editor = open ? getLiveEditor(path) : null;

  // The note's live text, subscribed to ONLY while the drawer is open: the
  // collapsed-to-"" selector makes a keystroke a no-op for this component the
  // rest of the time. Open, it matters — editing a property in the panel above
  // rewrites the frontmatter, and the tag chips below are derived from it.
  const content = useOpenNote((s) => (open ? s.editor.content : ""));

  // ONE parse for headings/tags/tasks — the same pure projection the knowledge
  // index runs, but over the LIVE buffer. The two agree once the index catches
  // up with a save; this one also sees UNSAVED edits, which is what the counts
  // below need to stay honest while you type.
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
    <Drawer direction="right" open={open} onOpenChange={setOpen}>
      {/* vaul is Radix-backed: composition is `asChild`, not the `render` prop
          the Base UI components in @repo/ui take. */}
      <DrawerTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Page details"
          title="Page details"
          className="size-7 px-0 text-muted-foreground hover:text-foreground"
        >
          <InfoIcon className="size-4" />
        </Button>
      </DrawerTrigger>
      {/* Escaping the floating-surface width cap is the whole reason this is a
          drawer. The direction prefix has to be repeated to beat the
          component's own default — see the note on DrawerContent. */}
      <DrawerContent className="data-[vaul-drawer-direction=right]:w-[30rem] data-[vaul-drawer-direction=right]:sm:max-w-[92vw]">
        <DrawerHeader className="border-b border-border pr-12">
          <DrawerTitle>Page details</DrawerTitle>
          <DrawerDescription className="truncate text-xs" title={path}>
            {basenamePath(path)}
          </DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4">
          {/* Primary: the editable frontmatter. First thing under the header,
              full width, no disclosure — this is what people open the drawer
              for. */}
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
      </DrawerContent>
    </Drawer>
  );
}
