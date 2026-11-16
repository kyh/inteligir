// An item's rich surface, by its id: the editor bound to the note's live document
// (`note-connection.ts`), drawn only once that document has synced, so no device seeds a note and
// nothing is typed into a value the note then replaces. Each item gets a connection of its own, and
// each document an editor of its own, since a reopen replaces the document. An edit reaches the
// note as it is typed; with no connection, or a note that holds its edits back, the surface reads
// but takes no edit and says why above the text, and a note whose opening stalled shows what the
// host holds of it until it opens. A formula's display follows the pills it names.

import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { nanoid } from "platejs";
import type { SlateEditor } from "platejs";
import { Plate, useEditorRef, usePlateEditor } from "platejs/react";
import { YjsEditor } from "@slate-yjs/core";
import type * as Y from "yjs";

import { deferred } from "@repo/contract/deferred";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import { NEEDS_CONNECTION } from "@repo/contract/needs-connection";

import { cn } from "@repo/ui/lib/cn";

import { closeOwnPickers } from "@repo/editor/combobox-input";
import { Editor, EditorContainer, editorColumnPx } from "@repo/editor/editor-chrome";
import { useEditorProfile } from "@repo/editor/editor-profile";
import {
  followItemFormulas,
  scheduleFormulaRecompute,
} from "@repo/editor/formulas/formula-recompute";
import { getEditorHostIo } from "@repo/editor/host-io";
import type { NoteHost } from "@repo/editor/host-io";
import { WRITE_PLACEHOLDER } from "@repo/editor/kits/block-placeholder-kit";
import { PROFILE_KITS } from "@repo/editor/kits/profile-kits";
import {
  YHistoryPlugin,
  flushEdits,
  noteRoot,
  yjsBindingPlugin,
} from "@repo/editor/live/yjs-binding";
import { getLiveEditor, registerLiveEditor } from "@repo/editor/live-editor";
import { OpenItemPlugin } from "@repo/editor/open-item";

import { HeldItem } from "./held-item";
import { noteConnection } from "./note-connection";
import type { NoteConnection, NoteEdits, NoteHeld } from "./note-connection";
import { Notice } from "./notice";

// the name every editor on this page gives the pickers it opens, which outlives a document a
// reopen replaces, so a picker opened here before the reopen still takes its keys here
const PAGE_USER_ID = nanoid();

// a long item's top level renders in runs of this many blocks, so a keystroke re-renders one run
// and a run off screen skips its layout and paint (EditorChunk, in editor-chrome.tsx)
const CHUNK_BLOCKS = 100;

export const MISSING_ITEM = "This item isn't in your library. It may have been deleted for good.";

// why a note that is open takes no edit, in the person's words; a full note stays so for everyone,
// since 8 MB is past anything typed, and a cut that only shrinks it would cost a copy of the note
// on every edit
export const HELD_BACK: Record<NoteHeld, string> = {
  deleted: "This item is in Deleted. Restore it to edit it.",
  full: "This note is as long as a note can be, so it takes no more. Copy what you need into a new note. You can still move this one to Deleted.",
};

// a paste or a drop past what the note takes in one frame, which it refused whole
export const REFUSED_EDIT =
  "That was too much to add at once, so this note is going back to what it held.";

// the open note as a host reaches it: what a leave asks of it
export interface OpenNote {
  // told whenever `unsaved` or `unsent` may have turned
  readonly subscribe: (listener: () => void) => () => void;
  // whether the note holds every edit made here before the call, a file still being kept among
  // them, as `NoteConnection.holds` answers
  readonly holds: () => Promise<boolean>;
  // an edit made here, or a file still being kept, that a leave now would wait on or lose
  readonly unsaved: () => boolean;
  // an edit made here while no connection could carry it, until the socket syncs again
  readonly unsent: () => boolean;
}

export interface ItemEditorProps {
  readonly itemId: string;
  // the open note, once it follows the item, and null once it stops
  readonly onNote: (note: OpenNote | null) => void;
}

interface FollowedNote extends OpenNote {
  readonly connection: NoteConnection;
  // a file being kept for a block of this note, which a leave waits for
  readonly keep: (kept: Promise<void>) => void;
}

const followNote = (itemId: string, host: NoteHost): FollowedNote => {
  const connection = noteConnection(itemId, host);
  const keeping = new Set<Promise<void>>();
  const listeners = new Set<() => void>();
  const moved = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };
  connection.subscribe(moved);
  // a keep starting or ending moves no status, so it tells the listeners itself
  const track = async (kept: Promise<void>): Promise<void> => {
    keeping.add(kept);
    moved();
    await Promise.allSettled([kept]);
    keeping.delete(kept);
    moved();
  };
  const open = () => {
    const status = connection.status();
    return status.kind === "open" ? status : null;
  };
  // a file being kept whose block can still land, which only a note that takes edits is handed
  const keeps = (): boolean => keeping.size > 0 && open()?.edits.kind === "live";
  const nextMove = async (): Promise<void> => {
    const { promise, resolve } = deferred();
    listeners.add(resolve);
    await promise;
    listeners.delete(resolve);
  };
  return {
    connection,
    holds: async () => {
      while (keeps()) {
        await nextMove();
      }
      // Slate hands the binding an edit only once its change settles, a moment after the edit
      const drawn = getLiveEditor(itemId);
      if (drawn !== null) {
        flushEdits(drawn);
      }
      return await connection.holds();
    },
    keep: (kept) => {
      void track(kept);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    unsaved: () => keeps() || open()?.unsaved === true,
    unsent: () => open()?.unsent === true,
  };
};

// the item's pills recomputed once it opens, after each change and when another item changes,
// since a pill may name one (`followItemFormulas`)
const FormulaRecompute = ({ itemId }: { itemId: string }) => {
  const editor = useEditorRef();
  useEffect(() => followItemFormulas(editor, itemId, getEditorHostIo()), [editor, itemId]);
  return null;
};

// The editor answers for its item by the item's id, where a writer outside the surface finds it,
// once Plate has drawn its text: mounted after the container, in the commit that draws it.
const AnswersForItem = ({ itemId }: { itemId: string }) => {
  const editor = useEditorRef();
  useEffect(() => registerLiveEditor(itemId, editor), [editor, itemId]);
  return null;
};

// A connect hands the editor fresh nodes in place of the ones it held, so the surface draws the
// editor anew over each connect, and not before the first: a component kept from before would
// render a node the editor no longer holds.
const bindingOf = (editor: SlateEditor) => {
  let connects = 0;
  const listeners = new Set<() => void>();
  return {
    connect: () => {
      if (!YjsEditor.isYjsEditor(editor)) {
        throw new Error("the item editor binds its note");
      }
      YjsEditor.connect(editor);
      connects += 1;
      for (const listener of listeners) {
        listener();
      }
      return () => {
        // before the disconnect, whose flush is the last write this editor makes to the note
        closeOwnPickers(editor);
        YjsEditor.disconnect(editor);
      };
    },
    connects: () => connects,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

interface BoundSurfaceProps {
  readonly itemId: string;
  readonly doc: Y.Doc;
  readonly note: FollowedNote;
  // why the note takes no edit now, or null while it does
  readonly notice: string | null;
}

const BoundSurface = ({ itemId, doc, note, notice }: BoundSurfaceProps) => {
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
      yjsBindingPlugin({ localOrigin: Symbol(itemId), root: noteRoot(doc) }),
      YHistoryPlugin,
    ],
    userId: PAGE_USER_ID,
  });
  const binding = useMemo(() => bindingOf(editor), [editor]);
  const connects = useSyncExternalStore(binding.subscribe, binding.connects);
  useLayoutEffect(() => binding.connect(), [binding]);
  if (connects === 0) {
    return null;
  }
  return (
    <>
      {notice === null ? null : <Notice profile={profile} text={notice} />}
      <Plate
        key={connects}
        editor={editor}
        onValueChange={() => {
          scheduleFormulaRecompute(editor);
        }}
        readOnly={notice !== null}
      >
        <EditorContainer>
          <Editor placeholder={WRITE_PLACEHOLDER} spellCheck={false} />
        </EditorContainer>
        <AnswersForItem itemId={itemId} />
        {notice === null ? <FormulaRecompute itemId={itemId} /> : null}
      </Plate>
    </>
  );
};

const noticeOf = (edits: NoteEdits): string | null => {
  switch (edits.kind) {
    case "live": {
      return null;
    }
    case "offline": {
      return NEEDS_CONNECTION;
    }
    case "held": {
      return HELD_BACK[edits.held];
    }
    case "refused": {
      return REFUSED_EDIT;
    }
    // no default
  }
};

// A note whose opening stalled, with no connection or no socket within the grace: what the host
// holds of the item, read once as this mounts and kept until the note opens, drawn read-only under
// the words every screen says of it. Nothing held, or a read that fails, leaves the words alone.
const StalledItem = ({ itemId }: { itemId: string }) => {
  const profile = useEditorProfile();
  const [held, setHeld] = useState<readonly LibraryBlock[] | null>(null);
  useEffect(() => {
    let live = true;
    const read = async (): Promise<void> => {
      try {
        const blocks = await getEditorHostIo().readItemBlocks(itemId);
        if (live) {
          setHeld(blocks);
        }
      } catch {
        // the words stand alone
      }
    };
    void read();
    return () => {
      live = false;
    };
  }, [itemId]);
  return held === null ? (
    <Notice profile={profile} text={NEEDS_CONNECTION} />
  ) : (
    <HeldItem itemId={itemId} blocks={held} notice={NEEDS_CONNECTION} />
  );
};

const ItemSurface = ({ itemId, onNote }: ItemEditorProps) => {
  const profile = useEditorProfile();
  const host = getEditorHostIo().notes;
  // made once for the surface, and inert until it starts, so the one a discarded render makes
  // leaves nothing running
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [note] = useState(() => followNote(itemId, host));
  const status = useSyncExternalStore(note.connection.subscribe, note.connection.status);
  const announce = useEffectEvent((next: OpenNote | null) => {
    onNote(next);
  });
  useEffect(() => {
    note.connection.start();
    announce(note);
    return () => {
      announce(null);
      note.connection.close();
    };
  }, [note]);
  if (status.kind === "missing") {
    return (
      <p className={cn(editorColumnPx(profile), "pt-4 text-body text-muted-foreground")}>
        {MISSING_ITEM}
      </p>
    );
  }
  if (status.kind === "opening") {
    return status.stalled ? <StalledItem itemId={itemId} /> : null;
  }
  return (
    <BoundSurface
      key={status.doc.guid}
      itemId={itemId}
      doc={status.doc}
      note={note}
      notice={noticeOf(status.edits)}
    />
  );
};

// keyed by the item's id: another item is another connection and another editor
export const ItemEditor = (props: ItemEditorProps) => <ItemSurface key={props.itemId} {...props} />;
