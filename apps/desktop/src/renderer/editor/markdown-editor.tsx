// Notion-style rich markdown editor built on Plate (platejs), used by the
// editor pane for `.md` documents. Round-trips markdown: deserialize the file
// text to Plate's value on mount, serialize back to markdown on every change
// so the editor's autosave persists it.
//
// Thin by design: the plugin/component composition lives in
// kits/editor-kit.ts (per-feature kit files whose Base halves compose the
// headless serialization mirror — see kits/base-kit.ts); this file owns only
// the seed/echo-dedupe lifecycle, the transient-AI settle seam, and the Plate
// surface.

import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import type { Value } from "platejs";
import { Plate, usePlateEditor } from "platejs/react";
import { serializeMd } from "@platejs/markdown";

import { releaseAiSession } from "@renderer/editor/ai/ai-session";
import { hasTransientSuggestions, resolveAllSuggestions } from "@renderer/editor/ai/suggestions";
import { hasTransientAiState } from "@renderer/editor/ai/transient";
import { registerTransientSettler } from "@renderer/editor/ai/transient-settle";
import { Editor, EditorContainer } from "@renderer/editor/editor-chrome";
import { registerLiveEditor } from "@renderer/editor/live-editor";
import { WRITE_PLACEHOLDER } from "@renderer/editor/kits/block-placeholder-kit";
import { EDITOR_KIT } from "@renderer/editor/kits/editor-kit";
import { MD_STRINGIFY, parseMarkdown } from "@renderer/editor/markdown/markdown-doc";
import { createDebouncer } from "@renderer/lib/debounce";
import { TableOfContents } from "@renderer/editor/toc";
import { useAiReviewStore } from "@renderer/stores/ai-review-store";

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
  /** Vault-relative path this editor serves — keys the transient-settle seam
   * so a flush routed to some OTHER note's path never resolves this editor's
   * AI session. */
  path: string;
  /** Markdown to render. Seeds the editor on mount and re-seeds it when the
   * prop changes externally (a vault reload / file switch) — see the effect. */
  value: string;
  /** Called with serialized markdown on every change. */
  onChange: (markdown: string) => void;
  /** Teardown escape hatch (#374): called with the settled markdown when the
   * editor unmounts while an AI suggestion session was still pending
   * (reject-all — the user's typing survives, the AI marks disappear). The
   * OWNER must route these bytes by `path`: by unmount time the open note
   * may already have changed, so the normal onChange must not carry them. */
  onSettled: (markdown: string) => void;
  /** Register a synchronous flush for the debounced serialize. The owner calls
   * it (via the note runtime's pre-flush hook) before any save/rename/close so
   * a keystroke still sitting in the serialize debounce reaches the controller
   * first. Optional so the raw-editor and harness paths compile unchanged. */
  onRegisterSerializeFlush?: (flush: () => void) => void;
};

export function MarkdownEditor({
  path,
  value,
  onChange,
  onSettled,
  onRegisterSerializeFlush,
}: Props) {
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
    // The transient-AI gate re-checked at FIRE time: the synchronous onChange
    // gate ran at schedule time, but an AI stream/suggestion session can start
    // inside the debounce window — serializing then would persist transient
    // marks (AI state never reaches disk). Skip; the resolving edit that lifts
    // the freeze fires onChange and reschedules, and the settle path routes
    // interleaved typing itself.
    if (hasTransientSuggestions(editor) || hasTransientAiState(editor)) return;
    const md = serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY });
    // Drop the echo a programmatic (re)seed produces — only real edits, which
    // diverge from the seeded text, propagate.
    if (md === seeded.current) return;
    seeded.current = null;
    lastValueProp.current = md;
    onChangeRef.current(md);
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
  // surface and resets `seeded` — matching the old synchronous behavior where
  // every keystroke had already propagated by reload time.
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

  // ---- Transient-AI settle seam (#374) -------------------------------------
  // While a suggestion session pends, autosave is frozen (the gate below) and
  // any typing the user interleaves exists ONLY in this editor's value.
  // Abandoning the session must not drop it: settle resolves reject-all (the
  // user's typing survives; the AI proposal reverts) and hands back the
  // settled markdown. The Plate onChange is suppressed for the duration —
  // settled bytes reach exactly ONE controller, routed by the caller.
  const settling = useRef(false);
  const settleSuggestions = useCallback((): string | null => {
    if (!hasTransientSuggestions(editor)) return null;
    settling.current = true;
    try {
      resolveAllSuggestions(editor, "reject");
    } finally {
      settling.current = false;
    }
    const md = serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY });
    // The settled bytes round back as the value prop — don't re-seed on them.
    lastValueProp.current = md;
    return md;
  }, [editor]);

  // Flush path: VaultProvider settles through this registration BEFORE
  // flushing this file (note switch/close, folder switch, explicit flush).
  useEffect(() => registerTransientSettler(path, settleSuggestions), [path, settleSuggestions]);

  // Expose this editor to chrome outside the Plate tree — the header's
  // "Page details" popover edits the frontmatter node through it, so property
  // writes ride this same serialize path to disk. Path-keyed like the
  // transient settler above.
  useEffect(() => registerLiveEditor(path, editor), [path, editor]);

  // Unmount path (note switch without a flush, raw-mode flip, surface
  // change): settle and hand the bytes to the owner for path-routed
  // persistence, and release the AI session — with one mounted editor this
  // teardown is the only thing that cancels an in-flight generation.
  const notifySettled = useEffectEvent(onSettled);
  useEffect(
    () => () => {
      const md = settleSuggestions();
      if (md !== null) notifySettled(md);
      releaseAiSession();
      useAiReviewStore.getState().setReviewing(path, false);
    },
    [settleSuggestions, path],
  );

  return (
    <Plate
      editor={editor}
      onChange={() => {
        // Teardown settle routes its bytes itself (see settleSuggestions).
        if (settling.current) return;
        // Selection-only flushes (caret moves, slate-react selection
        // re-syncs) never change bytes — skip the serialize pass and the
        // vault-context re-render it would otherwise trigger on every caret
        // move; per-event work stays bounded under input-event storms.
        if (editor.operations.every((op) => op.type === "set_selection")) return;
        // Transient-AI gate: while an AI stream or an unresolved suggestion
        // session is touching the document, freeze the save buffer at the
        // pre-session bytes — the marks are UI state, never content. The
        // resolving edit (accept/reject/discard) clears the transients and
        // the next onChange serializes the settled document. The header's
        // save badge surfaces the suggestion freeze as "Reviewing
        // suggestions" via the store.
        const reviewing = hasTransientSuggestions(editor);
        useAiReviewStore.getState().setReviewing(path, reviewing);
        if (reviewing || hasTransientAiState(editor)) return;
        // Defer the whole-document serialize behind a short debounce — this
        // event only marks the document dirty. The freeze above lifts through
        // an onChange (the accept/reject/discard IS an edit), which reaches
        // here and schedules, so a settle with no following keystroke still
        // propagates. Save/close paths flush synchronously via the runtime.
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
