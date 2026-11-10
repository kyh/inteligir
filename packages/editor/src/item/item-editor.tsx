// An item's rich surface, by its id: the editor bound to the note's live document
// (`note-connection.ts`), drawn only once that document has synced, so no device seeds a note and
// nothing is typed into a value the note then replaces. Each item gets a connection of its own,
// and each document an editor of its own, since a reopen replaces the document. An edit reaches
// the note as it is typed; with no connection, or a note that holds its edits back, the surface
// reads but takes no edit and says why above the text. A formula's display follows the pills it
// names, and the desktop draws the outline beside the text.

import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { SlateEditor } from "platejs";
import { Plate, useEditorRef, usePlateEditor } from "platejs/react";
import { YjsEditor } from "@slate-yjs/core";
import type * as Y from "yjs";

import { NEEDS_CONNECTION } from "@repo/contract/refusal-text";

import { cn } from "@repo/ui/lib/cn";

import { Editor, EditorContainer, editorColumnPx } from "@repo/editor/editor-chrome";
import { useEditorProfile } from "@repo/editor/editor-profile";
import type { EditorProfile } from "@repo/editor/editor-profile";
import { watchFileKeeps } from "@repo/editor/file-keeps";
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
import { registerLiveEditor } from "@repo/editor/live-editor";
import { OpenItemProvider } from "@repo/editor/open-item";
import { TableOfContents } from "@repo/editor/toc";

import { noteConnection } from "./note-connection";
import type { NoteConnection, NoteHeld, NoteStatus } from "./note-connection";

// a long item's top level renders in runs of this many blocks, so a keystroke re-renders one run
// and a run off screen skips its layout and paint (EditorChunk, in editor-chrome.tsx)
const CHUNK_BLOCKS = 100;

/** @internal */
export const MISSING_ITEM = "This item isn't in your library. It may have been deleted for good.";

// why a note that is open takes no edit, in the person's words; a full note stays so for everyone,
// since 8 MB is past anything typed, and a cut that only shrinks it would cost a copy of the note
// on every edit
/** @internal */
export const HELD_BACK: Record<NoteHeld, string> = {
  deleted: "This item is in Deleted. Restore it to edit it.",
  full: "This note is as long as a note can be, so it takes no more. Copy what you need into a new note. You can still move this one to Deleted.",
};

// the open note as a host reaches it: what it waits on before a leave
export interface OpenNote {
  readonly status: () => NoteStatus;
  readonly subscribe: (listener: () => void) => () => void;
  // true once the note holds every edit made here before the call, a file still being kept among
  // them; false when the note closes, or drops what this device held, first
  readonly whenSaved: () => Promise<boolean>;
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
  // the editor drawn over the note now, whose keeps and unsent edits a leave waits for
  readonly bind: (editor: SlateEditor) => () => void;
}

const followNote = (itemId: string, host: NoteHost): FollowedNote => {
  const connection = noteConnection(itemId, host);
  const keeping = new Set<Promise<void>>();
  let bound: SlateEditor | null = null;
  const track = async (kept: Promise<void>): Promise<void> => {
    keeping.add(kept);
    await Promise.allSettled([kept]);
    keeping.delete(kept);
  };
  return {
    bind: (editor) => {
      bound = editor;
      watchFileKeeps(editor, (kept) => {
        void track(kept);
      });
      return () => {
        if (bound === editor) {
          bound = null;
        }
      };
    },
    connection,
    status: connection.status,
    subscribe: connection.subscribe,
    unsent: connection.unsent,
    whenSaved: async () => {
      while (keeping.size > 0) {
        await Promise.allSettled(keeping);
      }
      // Slate hands the binding an edit only once its change settles, a moment after the edit
      if (bound !== null) {
        flushEdits(bound);
      }
      return await connection.whenSaved();
    },
  };
};

// the item's pills recomputed once it opens, after each change and when another item changes,
// since a pill may name one (`followItemFormulas`)
const FormulaRecompute = ({ itemId }: { itemId: string }) => {
  const editor = useEditorRef();
  useEffect(() => followItemFormulas(editor, itemId, getEditorHostIo()), [editor, itemId]);
  return null;
};

const Notice = ({ profile, text }: { profile: EditorProfile; text: string }) => (
  <div
    className={cn(
      editorColumnPx(profile),
      "sticky top-[env(safe-area-inset-top)] z-10 bg-background py-2 text-body",
    )}
  >
    <p className="text-muted-foreground">{text}</p>
  </div>
);

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
      yjsBindingPlugin({ localOrigin: Symbol(itemId), root: noteRoot(doc) }),
      YHistoryPlugin,
    ],
  });
  const binding = useMemo(() => bindingOf(editor), [editor]);
  const connects = useSyncExternalStore(binding.subscribe, binding.connects);
  useLayoutEffect(() => binding.connect(), [binding]);
  // the editor answers for its item by the item's id, where a writer outside the surface finds it
  useEffect(() => registerLiveEditor(itemId, editor), [itemId, editor]);
  useEffect(() => note.bind(editor), [editor, note]);
  if (connects === 0) {
    return null;
  }
  return (
    <OpenItemProvider itemId={itemId}>
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
        {notice === null ? <FormulaRecompute itemId={itemId} /> : null}
        {profile === "desktop" ? <TableOfContents /> : null}
      </Plate>
    </OpenItemProvider>
  );
};

const noticeOf = (status: Extract<NoteStatus, { kind: "open" }>): string | null => {
  if (!status.live) {
    return NEEDS_CONNECTION;
  }
  return status.held === null ? null : HELD_BACK[status.held];
};

const ItemSurface = ({ itemId, onNote }: ItemEditorProps) => {
  const profile = useEditorProfile();
  const host = getEditorHostIo().notes;
  // made once for the surface, and inert until it starts, so the one a discarded render makes
  // leaves nothing running
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [note] = useState(() => followNote(itemId, host));
  const status = useSyncExternalStore(note.subscribe, note.status);
  const offline = useSyncExternalStore(host.onOfflineChange, host.offline);
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
    return offline ? <Notice profile={profile} text={NEEDS_CONNECTION} /> : null;
  }
  return (
    <BoundSurface
      key={status.doc.guid}
      itemId={itemId}
      doc={status.doc}
      note={note}
      notice={noticeOf(status)}
    />
  );
};

// keyed by the item's id: another item is another connection and another editor
export const ItemEditor = (props: ItemEditorProps) => <ItemSurface key={props.itemId} {...props} />;
