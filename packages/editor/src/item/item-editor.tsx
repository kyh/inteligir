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

const CHUNK_BLOCKS = 100;

export const MISSING_ITEM = "This item isn't in your library. It may have been deleted for good.";

export const OFFLINE_KEEPS =
  "You're offline. What you type is kept on this device and saves once you're back.";

export const NOTICES: Record<NoteNotice, string> = {
  agent: "The agent is editing this note. What you type saves once it's done.",
  conflict:
    "This note changed somewhere else while you were typing, and your last changes weren't saved.",
  deleted: "This item is in Deleted. Restore it to edit it.",
  "file-missing":
    "A file in this note isn't in your library anymore, so what you type isn't saved. Remove it to save again.",
  full: "This note is longer than a note can be, so what you type isn't saved. Shorten it, or copy what you need into a new note.",
  offline: OFFLINE_KEEPS,
};

export const SHOW_LATEST = "Show the latest";
export const KEEP_MINE = "Save mine as a new note";

export interface OpenNote {
  readonly itemId: string;
  readonly subscribe: (listener: () => void) => () => void;
  readonly holds: () => Promise<boolean>;
  readonly unsaved: () => boolean;
  readonly unloadLoses: () => boolean;
  readonly agentEditing: (callId: string) => void;
  readonly agentEdited: (callId: string) => void;
}

export interface ItemEditorProps {
  readonly itemId: string;
  readonly onNote: (note: OpenNote | null) => void;
}

interface FollowedNote extends OpenNote {
  readonly saver: NoteSaver;
  readonly keep: (kept: Promise<void>) => void;
}

const followNote = (itemId: string, host: NoteHost) => {
  const saver = new NoteSaver(itemId, host);
  const keeping = new Set<Promise<void>>();
  const listeners = new Set<() => void>();

  const moved = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  saver.subscribe(moved);

  const track = async (kept: Promise<void>) => {
    keeping.add(kept);
    moved();
    await Promise.allSettled([kept]);
    keeping.delete(kept);
    moved();
  };

  const keeps = () => {
    const view = saver.view();

    return keeping.size > 0 && view.kind === "open" && !takesNoEdit(view.notice);
  };

  const nextMove = async () => {
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
  } satisfies FollowedNote;
};

const AnswersForItem = ({ itemId }: { itemId: string }) => {
  const editor = useEditorRef();
  useEffect(() => registerLiveEditor(itemId, editor), [editor, itemId]);

  return null;
};

const keptAsNote = async (mine: { title: string; blocks: readonly BodyBlock[] }) => {
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

const ConflictChoices = ({ saver }: { saver: NoteSaver }) => {
  const [keeping, setKeeping] = useState(false);

  const keepMine = async () => {
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
  readonly blocks: readonly BodyBlock[];
  readonly notice: NoteNotice | null;
}

const SavedSurface = ({ itemId, note, blocks, notice }: SavedSurfaceProps) => {
  const profile = useEditorProfile();

  const editor = usePlateEditor({
    chunking: { chunkSize: CHUNK_BLOCKS, contentVisibilityAuto: false },
    navigationFeedback: false,
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

    default: {
      throw new Error(`unexpected ${String(view satisfies never)}`);
    }
  }
};

export const ItemEditor = (props: ItemEditorProps) => <ItemSurface key={props.itemId} {...props} />;
