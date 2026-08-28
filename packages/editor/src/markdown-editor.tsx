// Notion-style rich markdown editor built on Plate (platejs), used by the
// editor pane for `.md` documents. Round-trips markdown: deserialize the file
// text to Plate's value on mount, serialize back to markdown on every change
// so the editor's autosave persists it.
//
// Thin by design: the plugin/component composition lives in
// kits/editor-kit.ts (per-feature kit files whose Base halves compose the
// headless serialization mirror — see kits/base-kit.ts); this file owns only
// the seed/echo-dedupe lifecycle and the Plate surface.

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

/** How long after the last qualifying change the whole-document serialize
 * waits before it runs. Bounds per-keystroke work without changing what
 * reaches disk — the 600ms autosave debounce downstream gates the write. */
const SERIALIZE_DEBOUNCE_MS = 150;

// Seed markdown → Plate value through the owned pipeline. Unparseable content
// is impossible behind the richAvailable parse gate, but never crash the
// surface: fall back to an empty paragraph and log.
function seedValue(md: string): Value {
  const parsed = parseMarkdown(md);
  if (parsed.ok) return parsed.value;
  console.error("MarkdownEditor: seed markdown failed to parse", parsed.reason);
  return [{ children: [{ text: "" }], type: "p" }];
}

type Props = {
  /** Vault-relative path this editor serves — keys the live-editor registry so
   * chrome outside the Plate tree can never grab an editor serving some OTHER
   * note. */
  path: string;
  /** Markdown to render. Seeds the editor on mount and re-seeds it when the
   * prop changes externally (a vault reload / file switch) — see the effect. */
  value: string;
  /** Called with serialized markdown on every change. */
  onChange: (markdown: string) => void;
  /** Register a synchronous flush for the debounced serialize. The owner calls
   * it (via the note runtime's pre-flush hook) before any save/rename/close so
   * a keystroke still sitting in the serialize debounce reaches the controller
   * first. Optional so the raw-editor and harness paths compile unchanged. */
  onRegisterSerializeFlush?: (flush: () => void) => void;
};

export function MarkdownEditor({ path, value, onChange, onRegisterSerializeFlush }: Props) {
  const editor = usePlateEditor({
    plugins: EDITOR_KIT,
    value: () => seedValue(value),
  });

  // The last raw `value` prop we've reflected into the editor — dedupes the
  // re-seed effect and our own emissions so neither re-seeds the editor.
  const lastValueProp = useRef(value);
  // The serialized markdown immediately after a (re)seed. Seeding the editor
  // makes Plate emit onChange with this normalized text; recognizing it lets us
  // drop that echo instead of treating it as a user edit (which would autosave
  // a normalized rewrite over the agent's/file's content). Initialized to the
  // mount value's normalized form so the first-render onChange is dropped too.
  const [initialSeed] = useState(() =>
    serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY }),
  );
  const seeded = useRef<string | null>(initialSeed);

  // ---- Deferred whole-document serialize -----------------------------------
  // The actual serialize → echo-dedupe → emit, run behind the scheduler rather
  // than synchronously in onChange so it's off the per-keystroke path. Reads
  // live refs (editor is stable; onChange is reffed) so the scheduler holds one
  // stable closure for the editor's lifetime.
  const onChangeRef = useRef(onChange);
  const doSerialize = useCallback(() => {
    const md = serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY });
    // Drop the echo a programmatic (re)seed produces — only real edits, which
    // diverge from the seeded text, propagate.
    if (md === seeded.current) return;
    seeded.current = null;
    lastValueProp.current = md;
    onChangeRef.current(md);
    // Behind the settle, never per keystroke — a changed display re-enters
    // this same path as an ordinary edit.
    scheduleFormulaRecompute(editor);
  }, [editor]);
  const doSerializeRef = useRef(doSerialize);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
    doSerializeRef.current = doSerialize;
  }, [onChange, doSerialize]);
  // One scheduler for the editor's lifetime; the closure re-reads the ref so it
  // never goes stale even though doSerialize's identity is already stable.
  const [scheduler] = useState(() =>
    createDebouncer(() => doSerializeRef.current(), SERIALIZE_DEBOUNCE_MS),
  );

  // Re-seed when `value` changes from the outside (e.g. the agent edited the
  // file and the panel reloaded it). Without this the Plate surface keeps the
  // stale document and the next edit would serialize it back over the newer
  // file. Flush any pending serialize FIRST: the user's in-debounce keystroke
  // must reach the controller before the external content overwrites the
  // surface and resets `seeded` — every keystroke has to have propagated by
  // the time a reload lands.
  useEffect(() => {
    if (value === lastValueProp.current) return;
    scheduler.flush();
    lastValueProp.current = value;
    editor.tf.setValue(seedValue(value));
    seeded.current = serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY });
  }, [value, editor, scheduler]);

  // Register the synchronous flush with the owner (via the note runtime's
  // pre-flush hook) once — save/rename/close run it before flushing so a
  // keystroke still in the serialize debounce lands first.
  const registerSerializeFlush = useEffectEvent((flush: () => void) => {
    onRegisterSerializeFlush?.(flush);
  });
  useEffect(() => {
    registerSerializeFlush(() => scheduler.flush());
  }, [scheduler]);

  // Unmount (note switch without a flush, raw-mode flip, surface change): flush
  // a pending serialize so the keystroke isn't lost. onChange routes by this
  // editor's `path`, so it no-ops if the open note already changed.
  useEffect(() => () => scheduler.flush(), [scheduler]);

  // Formula recompute: once on open, and again when the vault under the note
  // moves (a referenced variable in ANOTHER note may have changed). The host
  // seam is absent in headless tests — a mount without it simply computes
  // nothing until the app installs one.
  useEffect(() => {
    scheduleFormulaRecompute(editor);
    let unsubscribe = (): void => {};
    try {
      unsubscribe = getEditorHostIo().onVaultChanged(() => {
        scheduleFormulaRecompute(editor);
      });
    } catch {
      // no host installed (unit tests) — open-note recompute already ran
    }
    return () => {
      unsubscribe();
      cancelFormulaRecompute(editor);
    };
  }, [editor]);

  // Expose this editor to chrome outside the Plate tree — the right panel's
  // Properties tab edits the frontmatter node through it, so property writes
  // ride this same serialize path to disk.
  useEffect(() => registerLiveEditor(path, editor), [path, editor]);

  return (
    <Plate
      editor={editor}
      onChange={() => {
        // Selection-only flushes (caret moves, slate-react selection
        // re-syncs) never change bytes — skip the serialize pass and the
        // open-note re-render it would otherwise trigger on every caret
        // move; per-event work stays bounded under input-event storms.
        if (editor.operations.every((op) => op.type === "set_selection")) return;
        // Defer the whole-document serialize behind a short debounce — this
        // event only marks the document dirty. Save/close paths flush
        // synchronously via the runtime.
        scheduler.schedule();
      }}
    >
      {/* EditorContainer is the relative wrapper the cursor overlay's
          selection ghost and the floating toolbar (afterEditable renders)
          position against. The toolbar itself renders from FloatingToolbarKit. */}
      <EditorContainer>
        {/* The editor-level placeholder covers the pristine-empty doc —
            BlockPlaceholderPlugin deliberately skips that state (its
            isPristineEmptyEditor gate) and only handles empty blocks in
            non-empty docs. Same copy as the kit's `p` entry so the hint
            reads identically in both states. */}
        <Editor placeholder={WRITE_PLACEHOLDER} spellCheck={false} />
      </EditorContainer>
      <TableOfContents />
    </Plate>
  );
}
