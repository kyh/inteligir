import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import type { Value } from "platejs";
import { Plate, usePlateEditor } from "platejs/react";
import { serializeMd } from "@platejs/markdown";

import { Editor, EditorContainer } from "@repo/editor/editor-chrome";
import { registerLiveEditor } from "@repo/editor/live-editor";
import { WRITE_PLACEHOLDER } from "@repo/editor/kits/block-placeholder-kit";
import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { MD_STRINGIFY, parseMarkdown } from "@repo/editor/markdown/markdown-doc";
import { createDebouncer } from "@repo/editor/lib/debounce";
import {
  cancelFormulaRecompute,
  scheduleFormulaRecompute,
} from "@repo/editor/formulas/formula-recompute";
import { getEditorHostIo } from "@repo/editor/host-io";
import { TableOfContents } from "@repo/editor/toc";

// bounds per-keystroke work; the 600ms autosave debounce downstream gates the write.
const SERIALIZE_DEBOUNCE_MS = 150;

function seedValue(md: string): Value {
  const parsed = parseMarkdown(md);
  if (parsed.ok) return parsed.value;
  console.error("MarkdownEditor: seed markdown failed to parse", parsed.reason);
  return [{ children: [{ text: "" }], type: "p" }];
}

type Props = {
  path: string;
  value: string;
  onChange: (markdown: string) => void;
  onRegisterSerializeFlush?: (flush: () => void) => void;
};

export function MarkdownEditor({ path, value, onChange, onRegisterSerializeFlush }: Props) {
  const editor = usePlateEditor({
    plugins: EDITOR_KIT,
    value: () => seedValue(value),
  });

  // dedupes the re-seed effect against our own emissions.
  const lastValueProp = useRef(value);
  // Seeding makes Plate emit onChange with the normalized text; that echo must not count as an
  // edit or it autosaves a normalized rewrite over the file.
  const [initialSeed] = useState(() =>
    serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY }),
  );
  const seeded = useRef<string | null>(initialSeed);

  const onChangeRef = useRef(onChange);
  const doSerialize = useCallback(() => {
    const md = serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY });
    if (md === seeded.current) return;
    seeded.current = null;
    lastValueProp.current = md;
    onChangeRef.current(md);
    // behind the settle, never per keystroke; a changed display re-enters this path as an ordinary edit.
    scheduleFormulaRecompute(editor);
  }, [editor]);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  // the Effect Event keeps the debouncer's one stable closure dispatching to the latest doSerialize.
  const runSerialize = useEffectEvent(() => doSerialize());
  const [scheduler] = useState(() => createDebouncer(runSerialize, SERIALIZE_DEBOUNCE_MS));

  // Flush first: an in-debounce keystroke must reach the controller before the external
  // content overwrites the surface and resets `seeded`.
  useEffect(() => {
    if (value === lastValueProp.current) return;
    scheduler.flush();
    lastValueProp.current = value;
    editor.tf.setValue(seedValue(value));
    seeded.current = serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY });
  }, [value, editor, scheduler]);

  const registerSerializeFlush = useEffectEvent((flush: () => void) => {
    onRegisterSerializeFlush?.(flush);
  });
  useEffect(() => {
    registerSerializeFlush(() => scheduler.flush());
  }, [scheduler]);

  // onChange routes by `path`, so a flush after a note switch no-ops.
  useEffect(() => () => scheduler.flush(), [scheduler]);

  // a referenced variable in another note may have changed.
  useEffect(() => {
    scheduleFormulaRecompute(editor);
    let unsubscribe = (): void => {};
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

  return (
    <Plate
      editor={editor}
      onChange={() => {
        // selection-only flushes never change bytes; skip the serialize and the re-render it triggers.
        if (editor.operations.every((op) => op.type === "set_selection")) return;
        scheduler.schedule();
      }}
    >
      <EditorContainer>
        <Editor placeholder={WRITE_PLACEHOLDER} spellCheck={false} />
      </EditorContainer>
      <TableOfContents />
    </Plate>
  );
}
