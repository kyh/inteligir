// An item's rich surface, by its id: the editor over the item's own blocks (`item-session.ts`),
// which the session reads in, writes after a pause and lays changes from elsewhere into. The
// surface holds no copy of the value: a change only tells the session the value moved. Each item
// gets an editor and a session of its own, so the last write of the item left behind diffs that
// item's value and never the next one's, and the editor is drawn only once the item's blocks are
// in it, so nothing is typed into a value the item then replaces. Why an edit is not saved stays
// in view above the text, on every host. A formula's display follows the pills it names, and the
// desktop draws the outline beside the text.

import { useEffect, useEffectEvent, useState, useSyncExternalStore } from "react";
import { Plate, useEditorRef, usePlateEditor } from "platejs/react";

import { cn } from "@repo/ui/lib/cn";

import { Editor, EditorContainer, editorColumnPx } from "@repo/editor/editor-chrome";
import { useEditorProfile } from "@repo/editor/editor-profile";
import {
  followItemFormulas,
  scheduleFormulaRecompute,
} from "@repo/editor/formulas/formula-recompute";
import { WRITE_PLACEHOLDER } from "@repo/editor/kits/block-placeholder-kit";
import { PROFILE_KITS } from "@repo/editor/kits/profile-kits";
import { registerLiveEditor } from "@repo/editor/live-editor";
import { OpenItemProvider } from "@repo/editor/open-item";
import { TableOfContents } from "@repo/editor/toc";

import { createItemSession } from "./item-session";
import type { ItemSession, ItemSessionPorts, ItemStore } from "./item-session";

// a long item's top level renders in runs of this many blocks, so a keystroke re-renders one run
// and a run off screen skips its layout and paint (EditorChunk, in editor-chrome.tsx)
const CHUNK_BLOCKS = 100;

/** @internal */
export const MISSING_ITEM =
  "This item isn't on this device. It was deleted, or hasn't reached it yet.";

export interface ItemEditorProps {
  readonly itemId: string;
  // read once, when the item opens: a host that hands over another store opens the item again
  // under a new key
  readonly ports: ItemSessionPorts;
  // the session, once it follows the item: what a host flushes and reads the status of
  readonly onSession: (session: ItemSession | null) => void;
}

// the item's pills recomputed once it opens, after each change and when another item changes,
// since a pill may name one (`followItemFormulas`)
const FormulaRecompute = ({ itemId, store }: { itemId: string; store: ItemStore }) => {
  const editor = useEditorRef();
  useEffect(() => followItemFormulas(editor, itemId, store), [editor, itemId, store]);
  return null;
};

const ItemSurface = ({ itemId, ports, onSession }: ItemEditorProps) => {
  const profile = useEditorProfile();
  const editor = usePlateEditor({
    chunking: { chunkSize: CHUNK_BLOCKS, contentVisibilityAuto: false },
    // Plate's navigation flash, which no surface uses, subscribes every element to the editor:
    // one store atom per element, each recomputed on every change
    navigationFeedback: false,
    plugins: PROFILE_KITS[profile],
  });
  // made once for the surface's editor, and inert until it starts, so the one a discarded render
  // makes leaves nothing running
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [session] = useState(() => createItemSession(itemId, editor, ports));
  const status = useSyncExternalStore(session.subscribe, session.status);
  const announce = useEffectEvent((next: ItemSession | null) => {
    onSession(next);
  });
  useEffect(() => {
    void session.start();
    announce(session);
    return () => {
      announce(null);
      void session.close();
    };
  }, [session]);
  // the editor answers for its item by the item's id: a highlight the chord makes, and a writer
  // outside the surface, find it there
  useEffect(() => registerLiveEditor(itemId, editor), [itemId, editor]);
  if (status.kind === "missing") {
    return (
      <p className={cn(editorColumnPx(profile), "pt-4 text-body text-muted-foreground")}>
        {MISSING_ITEM}
      </p>
    );
  }
  if (status.kind === "opening") {
    return null;
  }
  const handleValueChange = (): void => {
    session.edited();
    scheduleFormulaRecompute(editor);
  };
  return (
    <OpenItemProvider itemId={itemId}>
      {status.failure === null ? null : (
        <p
          role="alert"
          className={cn(
            editorColumnPx(profile),
            "sticky top-[env(safe-area-inset-top)] z-10 bg-background py-2 text-body text-destructive",
          )}
        >
          {status.failure}
        </p>
      )}
      <Plate editor={editor} onValueChange={handleValueChange}>
        <EditorContainer>
          <Editor placeholder={WRITE_PLACEHOLDER} spellCheck={false} />
        </EditorContainer>
        <FormulaRecompute itemId={itemId} store={ports.store} />
        {profile === "desktop" ? <TableOfContents /> : null}
      </Plate>
    </OpenItemProvider>
  );
};

// keyed by the item's id: another item is another editor and another session
export const ItemEditor = (props: ItemEditorProps) => <ItemSurface key={props.itemId} {...props} />;
