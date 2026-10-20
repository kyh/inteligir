import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef } from "react";
import type { Value } from "platejs";
import { Plate, usePlateEditor } from "platejs/react";

import { Editor, EditorContainer } from "@repo/editor/editor-chrome";
import { useEditorProfile } from "@repo/editor/editor-profile";
import type { EditorProfile } from "@repo/editor/editor-profile";
import { announceLiveEditorEdit, registerLiveEditor } from "@repo/editor/live-editor";
import { clearNoteStats, collectNoteStats, publishNoteStats } from "@repo/editor/note-stats";
import { WRITE_PLACEHOLDER } from "@repo/editor/kits/block-placeholder-kit";
import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { TOUCH_EDITOR_KIT } from "@repo/editor/kits/touch-editor-kit";
import { parseMarkdown, serializeNote } from "@repo/editor/markdown/markdown-doc";
import { createDebouncer } from "@repo/editor/lib/debounce";
import type { Debouncer } from "@repo/editor/lib/debounce";
import {
  cancelFormulaRecompute,
  scheduleFormulaRecompute,
} from "@repo/editor/formulas/formula-recompute";
import { getEditorHostIo } from "@repo/editor/host-io";
import { TableOfContents } from "@repo/editor/toc";

// typed by the union of both kits' plugins, since usePlateEditor infers its plugin type from one
// array and refuses a union of two
export const PROFILE_KITS: Record<
  EditorProfile,
  ((typeof EDITOR_KIT)[number] | (typeof TOUCH_EDITOR_KIT)[number])[]
> = { desktop: EDITOR_KIT, touch: TOUCH_EDITOR_KIT };

// a long note's top level renders in runs of this many blocks, so a keystroke re-renders one run
// and a run off screen skips its layout and paint (EditorChunk, in editor-chrome.tsx).
const CHUNK_BLOCKS = 100;

// bounds per-keystroke work; the 600ms autosave debounce downstream gates the write.
const SERIALIZE_DEBOUNCE_MS = 150;

const seedValue = (md: string): Value => {
  const parsed = parseMarkdown(md);
  if (parsed.ok) {
    return parsed.value;
  }
  console.error("MarkdownEditor: seed markdown failed to parse", parsed.reason);
  return [{ children: [{ text: "" }], type: "p" }];
};

interface Props {
  path: string;
  value: string;
  onChange: (markdown: string) => void;
  onRegisterSerializeFlush?: (flush: () => void) => void;
}

export const MarkdownEditor = ({ path, value, onChange, onRegisterSerializeFlush }: Props) => {
  const profile = useEditorProfile();
  const editor = usePlateEditor({
    chunking: { chunkSize: CHUNK_BLOCKS, contentVisibilityAuto: false },
    // Plate's navigation flash, which no surface uses, subscribes every element to the editor:
    // one store atom per element, each recomputed on every change.
    navigationFeedback: false,
    plugins: PROFILE_KITS[profile],
    value: () => seedValue(value),
  });

  // dedupes the re-seed effect against our own emissions.
  const lastValueProp = useRef(value);
  // Seeding makes Plate emit onChange with the normalized text; that echo must not count as an
  // edit or it autosaves a normalized rewrite over the file.
  const initialSeed = useMemo(() => serializeNote(editor), [editor]);
  const seeded = useRef<string | null>(initialSeed);

  const publishStats = useCallback(() => {
    publishNoteStats(path, collectNoteStats(editor));
  }, [path, editor]);

  const serialize = () => {
    const md = serializeNote(editor);
    if (md === seeded.current) {
      return;
    }
    seeded.current = null;
    lastValueProp.current = md;
    onChange(md);
    publishStats();
    // behind the settle, never per keystroke; a changed display re-enters this path, unrecorded by undo.
    scheduleFormulaRecompute(editor);
  };
  const serializeRef = useRef(serialize);
  useLayoutEffect(() => {
    serializeRef.current = serialize;
  });
  // One debouncer for the editor's life — rebuilding it would drop a pending flush — so it is
  // built on first use, and its callback reads the ref rather than closing over one serialize.
  // Not a useState initializer: that runs in render, and a closure over a ref handed out there
  // keeps the React Compiler off the whole component.
  const schedulerRef = useRef<Debouncer | null>(null);
  const getScheduler = useCallback((): Debouncer => {
    const existing = schedulerRef.current;
    if (existing !== null) {
      return existing;
    }
    const created = createDebouncer(() => {
      serializeRef.current();
    }, SERIALIZE_DEBOUNCE_MS);
    schedulerRef.current = created;
    return created;
  }, []);

  // Flush first, never cancel: the controller drained this debounce before taking bytes from
  // disk, so anything still pending was typed since, and it must reach the controller before
  // the new content overwrites the surface and resets `seeded`.
  useEffect(() => {
    if (value === lastValueProp.current) {
      return;
    }
    getScheduler().flush();
    lastValueProp.current = value;
    editor.tf.setValue(seedValue(value));
    seeded.current = serializeNote(editor);
    publishStats();
  }, [value, editor, getScheduler, publishStats]);

  const registerSerializeFlush = useEffectEvent((flush: () => void) => {
    onRegisterSerializeFlush?.(flush);
  });
  useEffect(() => {
    registerSerializeFlush(() => {
      getScheduler().flush();
    });
  }, [getScheduler]);

  // onChange routes by `path`, so a flush after a note switch no-ops.
  useEffect(
    () => () => {
      getScheduler().flush();
    },
    [getScheduler],
  );

  // a referenced variable in another note may have changed.
  useEffect(() => {
    scheduleFormulaRecompute(editor);
    const unsubscribe = getEditorHostIo().onVaultChanged(() => {
      scheduleFormulaRecompute(editor);
    });
    return () => {
      unsubscribe();
      cancelFormulaRecompute(editor);
    };
  }, [editor]);

  useEffect(() => registerLiveEditor(path, editor), [path, editor]);
  useEffect(() => {
    publishStats();
    return () => {
      clearNoteStats(path);
    };
  }, [path, publishStats]);

  return (
    <Plate
      editor={editor}
      onValueChange={() => {
        announceLiveEditorEdit();
        getScheduler().schedule();
      }}
    >
      <EditorContainer>
        <Editor placeholder={WRITE_PLACEHOLDER} spellCheck={false} />
      </EditorContainer>
      {profile === "desktop" ? <TableOfContents /> : null}
    </Plate>
  );
};
