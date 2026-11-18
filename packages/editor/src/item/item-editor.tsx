// An item's rich surface, by its id: the note read whole, the editor drawn over its blocks, and
// every edit saved whole a moment after it is typed (`note-save.ts`). A body someone else saved,
// or a merge of it with what is typed here, is laid in place; one that cannot be is drawn anew.
// While the note takes no edit (no connection, in Deleted, the agent editing it, or a block
// changed here and elsewhere apart) the surface reads but takes none and says why above the text.

import { useEffect, useEffectEvent, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { Plate, useEditorRef, usePlateEditor } from "platejs/react";

import { deferred } from "@repo/contract/deferred";
import { shownTitle } from "@repo/contract/items/item-name";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import { NEEDS_CONNECTION } from "@repo/contract/needs-connection";

import { Button } from "@repo/ui/components/button";
import { toast } from "@repo/ui/components/sonner";
import { cn } from "@repo/ui/lib/cn";

import { layBody } from "@repo/editor/headless/body/lay-body";
import { blocksOfValue, editorValueOf } from "@repo/editor/headless/body/note-blocks";
import { Editor, EditorContainer, editorColumnPx } from "@repo/editor/editor-chrome";
import { useEditorProfile } from "@repo/editor/editor-profile";
import { getEditorHostActions, getEditorHostIo } from "@repo/editor/host-io";
import type { NoteHost } from "@repo/editor/host-io";
import { WRITE_PLACEHOLDER } from "@repo/editor/kits/block-placeholder-kit";
import { PROFILE_KITS } from "@repo/editor/kits/profile-kits";
import { registerLiveEditor } from "@repo/editor/live-editor";
import { OpenItemPlugin } from "@repo/editor/open-item";

import { NoteSaver, takesNoEdit } from "./note-save";
import type { NoteNotice } from "./note-save";
import { Notice } from "./notice";
import { PasteCapPlugin } from "./paste-cap";
import { readCaret } from "./read-caret";

// a long item's top level renders in runs of this many blocks, so a keystroke re-renders one run
// and a run off screen skips its layout and paint (EditorChunk, in editor-chrome.tsx)
const CHUNK_BLOCKS = 100;

export const MISSING_ITEM = "This item isn't in your library. It may have been deleted for good.";

// what an open note says above its text, in the person's words
export const NOTICES: Record<NoteNotice, string> = {
  agent: "The agent is editing this note. What you type saves once it's done.",
  conflict:
    "This note changed somewhere else while you were typing, and your last changes weren't saved.",
  deleted: "This item is in Deleted. Restore it to edit it.",
  "file-missing":
    "A file in this note isn't in your library anymore, so what you type isn't saved. Remove it to save again.",
  full: "This note is longer than a note can be, so what you type isn't saved. Shorten it, or copy what you need into a new note.",
  offline: NEEDS_CONNECTION,
};

export const SHOW_LATEST = "Show the latest";
export const KEEP_MINE = "Save mine as a new note";

// the open note as a host reaches it: what a leave asks of it, and the agent's edits of it
export interface OpenNote {
  readonly itemId: string;
  // told whenever `unsaved` or `unloadLoses` may have turned
  readonly subscribe: (listener: () => void) => () => void;
  // whether the library holds every edit made here before the call, a file still being kept among
  // them, once what is unsaved has saved or can't
  readonly holds: () => Promise<boolean>;
  // an edit made here, or a file still being kept, that a leave now would wait on or lose
  readonly unsaved: () => boolean;
  // an edit a close or a reload of the page would lose now, which only the browser's own ask can
  // stop
  readonly unloadLoses: () => boolean;
  // the agent began editing this note in a call, and ended it
  readonly agentEditing: (callId: string) => void;
  readonly agentEdited: (callId: string) => void;
}

export interface ItemEditorProps {
  readonly itemId: string;
  // the open note, once it is read, and null once it closes
  readonly onNote: (note: OpenNote | null) => void;
}

interface FollowedNote extends OpenNote {
  readonly saver: NoteSaver;
  // a file being kept for a block of this note, which a leave waits for
  readonly keep: (kept: Promise<void>) => void;
}

const followNote = (itemId: string, host: NoteHost): FollowedNote => {
  const saver = new NoteSaver(itemId, host);
  const keeping = new Set<Promise<void>>();
  const listeners = new Set<() => void>();
  const moved = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };
  saver.subscribe(moved);
  // a keep starting or ending moves nothing the saver tells, so it tells the listeners itself
  const track = async (kept: Promise<void>): Promise<void> => {
    keeping.add(kept);
    moved();
    await Promise.allSettled([kept]);
    keeping.delete(kept);
    moved();
  };
  // a file being kept whose block can still land, which only a note that takes edits is handed
  const keeps = (): boolean => {
    const view = saver.view();
    return keeping.size > 0 && view.kind === "open" && !takesNoEdit(view.notice);
  };
  const nextMove = async (): Promise<void> => {
    const { promise, resolve } = deferred();
    listeners.add(resolve);
    await promise;
    listeners.delete(resolve);
  };
  return {
    agentEdited: saver.agentEdited,
    agentEditing: saver.agentEditing,
    holds: async () => {
      while (keeps()) {
        await nextMove();
      }
      return await saver.holds();
    },
    itemId,
    keep: (kept) => {
      void track(kept);
    },
    saver,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    unloadLoses: () => keeps() || saver.unloadLoses(),
    unsaved: () => keeps() || saver.unsaved(),
  };
};

// The editor answers for its item by the item's id, where a writer outside the surface finds it,
// once Plate has drawn its text: mounted after the container, in the commit that draws it.
const AnswersForItem = ({ itemId }: { itemId: string }) => {
  const editor = useEditorRef();
  useEffect(() => registerLiveEditor(itemId, editor), [editor, itemId]);
  return null;
};

// what is typed here made a note of its own, beside the item; false when it was not made
const keptAsNote = async (mine: {
  title: string;
  blocks: readonly BodyBlock[];
}): Promise<boolean> => {
  try {
    await getEditorHostActions().items.createNote({
      blocks: mine.blocks.map(({ block }) => block),
      title: `${shownTitle(mine.title)} (my version)`,
    });
    return true;
  } catch {
    return false;
  }
};

// A block changed here and elsewhere apart: the latest drawn in place of what was typed, or what
// was typed kept as a note of its own first.
const ConflictChoices = ({ saver }: { saver: NoteSaver }) => {
  const [keeping, setKeeping] = useState(false);
  const keepMine = async (): Promise<void> => {
    const mine = saver.mine();
    if (mine === null) {
      return;
    }
    setKeeping(true);
    const kept = await keptAsNote(mine);
    setKeeping(false);
    if (kept) {
      saver.showLatest();
    } else {
      toast.error("Your version couldn't be saved as a new note. Try again.");
    }
  };
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <Button
        variant="secondary"
        onClick={() => {
          saver.showLatest();
        }}
      >
        {SHOW_LATEST}
      </Button>
      <Button
        variant="secondary"
        disabled={keeping}
        onClick={() => {
          void keepMine();
        }}
      >
        {KEEP_MINE}
      </Button>
    </div>
  );
};

interface SavedSurfaceProps {
  readonly itemId: string;
  readonly note: FollowedNote;
  // the blocks the editor is drawn over, once
  readonly blocks: readonly BodyBlock[];
  readonly notice: NoteNotice | null;
}

const SavedSurface = ({ itemId, note, blocks, notice }: SavedSurfaceProps) => {
  const profile = useEditorProfile();
  const editor = usePlateEditor({
    chunking: { chunkSize: CHUNK_BLOCKS, contentVisibilityAuto: false },
    // Plate's navigation flash, which no surface uses, subscribes every element to the editor:
    // one store atom per element, each recomputed on every change
    navigationFeedback: false,
    // every block the editor makes is stored under its id, so ids are on wherever Plate's default
    // leaves them off (under test)
    nodeId: true,
    plugins: [
      ...PROFILE_KITS[profile],
      OpenItemPlugin.configure({ options: { itemId, onFileKeep: note.keep } }),
      PasteCapPlugin,
    ],
    value: () => editorValueOf(blocks),
  });
  useLayoutEffect(
    () =>
      note.saver.bind({
        lay: (next) => {
          readCaret(editor);
          return layBody(editor, next);
        },
        mine: () => blocksOfValue(editor.children),
      }),
    [editor, note],
  );
  return (
    <>
      {notice === null ? null : (
        <Notice profile={profile} text={NOTICES[notice]}>
          {notice === "conflict" ? <ConflictChoices saver={note.saver} /> : null}
        </Notice>
      )}
      <Plate
        editor={editor}
        readOnly={takesNoEdit(notice)}
        onValueChange={() => {
          note.saver.edited();
        }}
      >
        <EditorContainer>
          <Editor placeholder={WRITE_PLACEHOLDER} spellCheck={false} />
        </EditorContainer>
        <AnswersForItem itemId={itemId} />
      </Plate>
    </>
  );
};

const ItemSurface = ({ itemId, onNote }: ItemEditorProps) => {
  const profile = useEditorProfile();
  const host = getEditorHostIo().notes;
  // made once for the surface, and inert until it starts, so the one a discarded render makes
  // leaves nothing running
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [note] = useState(() => followNote(itemId, host));
  const view = useSyncExternalStore(note.saver.subscribe, note.saver.view);
  const announce = useEffectEvent((next: OpenNote | null) => {
    onNote(next);
  });
  useEffect(() => {
    note.saver.start();
    announce(note);
    return () => {
      announce(null);
      note.saver.close();
    };
  }, [note]);
  switch (view.kind) {
    case "missing": {
      return (
        <p className={cn(editorColumnPx(profile), "pt-4 text-body text-muted-foreground")}>
          {MISSING_ITEM}
        </p>
      );
    }
    case "opening": {
      return view.stalled ? <Notice profile={profile} text={NEEDS_CONNECTION} /> : null;
    }
    case "open": {
      return (
        <SavedSurface
          key={view.drawn}
          itemId={itemId}
          note={note}
          blocks={view.blocks}
          notice={view.notice}
        />
      );
    }
    // no default
  }
};

// keyed by the item's id: another item is another note and another editor
export const ItemEditor = (props: ItemEditorProps) => <ItemSurface key={props.itemId} {...props} />;
