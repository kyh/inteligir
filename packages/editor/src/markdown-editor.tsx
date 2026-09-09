import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef } from "react";
import type { Value } from "platejs";
import { Plate, usePlateEditor } from "platejs/react";
import { serializeMd } from "@platejs/markdown";

import { Editor, EditorContainer } from "@repo/editor/editor-chrome";
import { registerLiveEditor } from "@repo/editor/live-editor";
import { clearNoteStats, collectNoteStats, publishNoteStats } from "@repo/editor/note-stats";
import { WRITE_PLACEHOLDER } from "@repo/editor/kits/block-placeholder-kit";
import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { MD_STRINGIFY, parseMarkdown } from "@repo/editor/markdown/markdown-doc";
import { createDebouncer } from "@repo/editor/lib/debounce";
import type { Debouncer } from "@repo/editor/lib/debounce";
import {
  cancelFormulaRecompute,
  scheduleFormulaRecompute,
} from "@repo/editor/formulas/formula-recompute";
import { getEditorHostIo } from "@repo/editor/host-io";
import { TableOfContents } from "@repo/editor/toc";

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
  const editor = usePlateEditor({
    plugins: EDITOR_KIT,
    value: () => seedValue(value),
  });

  // dedupes the re-seed effect against our own emissions.
  const lastValueProp = useRef(value);
  // Seeding makes Plate emit onChange with the normalized text; that echo must not count as an
  // edit or it autosaves a normalized rewrite over the file.
  const initialSeed = useMemo(
    () => serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY }),
    [editor],
  );
  const seeded = useRef<string | null>(initialSeed);

  const publishStats = useCallback(() => {
    publishNoteStats(path, collectNoteStats(editor));
  }, [path, editor]);

  const onChangeRef = useRef(onChange);
  const doSerialize = useCallback(() => {
    const md = serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY });
    if (md === seeded.current) {
      return;
    }
    seeded.current = null;
    lastValueProp.current = md;
    onChangeRef.current(md);
    publishStats();
    // behind the settle, never per keystroke; a changed display re-enters this path as an ordinary edit.
    scheduleFormulaRecompute(editor);
  }, [editor, publishStats]);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  // One debouncer for the editor's life — rebuilding it would drop a pending flush — so it is
  // built on first use, and its callback reads the ref rather than closing over one doSerialize.
  const doSerializeRef = useRef(doSerialize);
  useLayoutEffect(() => {
    doSerializeRef.current = doSerialize;
  }, [doSerialize]);
  const schedulerRef = useRef<Debouncer | null>(null);
  const getScheduler = useCallback((): Debouncer => {
    const existing = schedulerRef.current;
    if (existing !== null) {
      return existing;
    }
    const created = createDebouncer(() => {
      doSerializeRef.current();
    }, SERIALIZE_DEBOUNCE_MS);
    schedulerRef.current = created;
    return created;
  }, []);

  // Flush first: an in-debounce keystroke must reach the controller before the external
  // content overwrites the surface and resets `seeded`.
  useEffect(() => {
    if (value === lastValueProp.current) {
      return;
    }
    getScheduler().flush();
    lastValueProp.current = value;
    editor.tf.setValue(seedValue(value));
    seeded.current = serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY });
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
    let unsubscribe = (): void => {
      /* empty */
    };
    try {
      unsubscribe = getEditorHostIo().onVaultChanged(() => {
        scheduleFormulaRecompute(editor);
      });
    } catch {
      // no host installed (unit tests)
    }
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
      onChange={() => {
        // selection-only flushes never change bytes; skip the serialize and the re-render it triggers.
        if (editor.operations.every((op) => op.type === "set_selection")) {
          return;
        }
        getScheduler().schedule();
      }}
    >
      <EditorContainer>
        <Editor placeholder={WRITE_PLACEHOLDER} spellCheck={false} />
      </EditorContainer>
      <TableOfContents />
    </Plate>
  );
};
