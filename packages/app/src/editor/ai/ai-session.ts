// AI session controller — the state machine behind the editor's AI menu.
// One session at a time; state lives in AiSessionPlugin options so the menu
// (afterEditable), the selection toolbar, and the slash menu all drive the
// same instance through the exported functions.
//
// Two flows, routed by intent:
// - generate: streams markdown below the caret's block, incrementally parsed
//   into real blocks under the transient `ai` mark (stream-markdown.ts;
//   accept keeps the blocks and strips the marks; discard undoes the inserts
//   precisely).
// - edit: rewrites the selection's blocks host-side, then lands the result as
//   per-change track-changes suggestions (suggestions.ts) reviewed in the
//   floating bar.
// Free-form prompts are classified host-side (generate on any failure);
// canned actions carry a fixed intent.

import {
  isHotkey,
  KEYS,
  NodeApi,
  RangeApi,
  type Path,
  type PluginConfig,
  type TRange,
} from "platejs";
import { createTPlatePlugin, type PlateEditor } from "platejs/react";
import { serializeMd } from "@platejs/markdown";

import type { AiIntentResult } from "@repo/features/inline-ai";

import { getBridge } from "@repo/app/lib/bridge";
import { createMarkdownStream, stripAiMarks } from "@repo/app/editor/ai/stream-markdown";
import { applyEditSuggestions } from "@repo/app/editor/ai/suggestions";
import { MD_STRINGIFY, parseMarkdown } from "@repo/app/editor/markdown/markdown-doc";

// ---------------------------------------------------------------------------
// Plugin state
// ---------------------------------------------------------------------------

export type AiMenuStatus =
  | "closed"
  | "input" // menu open, waiting for a prompt / action pick
  | "classifying" // free-form prompt sent for intent classification
  | "generating" // generate flow streaming into the document
  | "editing" // edit flow waiting for the rewritten markdown
  | "review" // generate flow finished — accept / discard / try again
  | "error";

type AiSessionOptions = {
  status: AiMenuStatus;
  /** DOM block the menu anchors under (null = cannot open). */
  anchor: HTMLElement | null;
  /** Editor selection captured when the menu opened. */
  savedSelection: TRange | null;
  error: string | null;
};

const DEFAULT_OPTIONS: AiSessionOptions = {
  status: "closed",
  anchor: null,
  savedSelection: null,
  error: null,
};

export const AiSessionPlugin = createTPlatePlugin<PluginConfig<"aiSession", AiSessionOptions>>({
  key: "aiSession",
  options: DEFAULT_OPTIONS,
  handlers: {
    onKeyDown: ({ editor, event }) => {
      if (isHotkey("mod+j", event)) {
        event.preventDefault();
        openAiMenu(editor);
        return;
      }
      // Potion behavior: a plain space in an empty paragraph opens the AI
      // menu. Plain paragraphs only — list items are `p` nodes wearing
      // listStyleType, and an empty bullet's space is more plausibly typing.
      // Autoformat rules all require preceding text, so nothing is stolen.
      if (
        event.key === " " &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.nativeEvent.isComposing &&
        editor.getOption(AiSessionPlugin, "status") === "closed"
      ) {
        const sel = editor.selection;
        if (sel && RangeApi.isCollapsed(sel)) {
          const block = editor.api.block();
          if (
            block &&
            block[0].type === KEYS.p &&
            !("listStyleType" in block[0]) &&
            NodeApi.string(block[0]).length === 0
          ) {
            event.preventDefault();
            openAiMenu(editor);
          }
        }
      }
    },
  },
});

// ---------------------------------------------------------------------------
// Canned actions
// ---------------------------------------------------------------------------

export type CannedActionId =
  | "continue"
  | "summarize"
  | "explain"
  | "improve"
  | "longer"
  | "shorter"
  | "grammar"
  | "simplify";

export type CannedAction = {
  id: CannedActionId;
  label: string;
  intent: "generate" | "edit";
  /** Which command set offers the action (potion's split): `cursor` when the
   * captured selection is collapsed, `selection` when text is selected. */
  scope: "cursor" | "selection";
  keywords: string[];
};

export const CANNED_ACTIONS: CannedAction[] = [
  {
    id: "continue",
    label: "Continue writing",
    intent: "generate",
    scope: "cursor",
    keywords: ["write", "more"],
  },
  {
    id: "summarize",
    label: "Summarize",
    intent: "generate",
    scope: "cursor",
    keywords: ["tldr", "summary"],
  },
  {
    id: "explain",
    label: "Explain",
    intent: "generate",
    scope: "cursor",
    keywords: ["what", "meaning"],
  },
  {
    id: "improve",
    label: "Improve writing",
    intent: "edit",
    scope: "selection",
    keywords: ["rewrite", "better"],
  },
  {
    id: "longer",
    label: "Make longer",
    intent: "edit",
    scope: "selection",
    keywords: ["expand", "elaborate"],
  },
  {
    id: "shorter",
    label: "Make shorter",
    intent: "edit",
    scope: "selection",
    keywords: ["concise", "shorten"],
  },
  {
    id: "grammar",
    label: "Fix spelling & grammar",
    intent: "edit",
    scope: "selection",
    keywords: ["spelling", "typo"],
  },
  {
    id: "simplify",
    label: "Simplify language",
    intent: "edit",
    scope: "selection",
    keywords: ["plain", "simple"],
  },
];

/** Translate targets offered on the AI menu's language page — a pragmatic
 * subset (free-form prompts cover the rest). */
export const TRANSLATE_LANGUAGES = [
  "English",
  "Spanish",
  "French",
  "German",
  "Portuguese",
  "Japanese",
  "Korean",
  "Chinese (Simplified)",
] as const;

const PROMPT_BASE =
  "You are a writing assistant inside a notes editor. Respond with ONLY the resulting text — no preamble, no surrounding quotes, no markdown code fences, no explanation.";

function generatePromptFor(
  action: CannedActionId | null,
  request: string,
  context: string,
): string {
  switch (action) {
    case "continue":
      return `${PROMPT_BASE}\n\nContinue the following text naturally with one short paragraph:\n\n${context}`;
    case "summarize":
      return `${PROMPT_BASE}\n\nWrite a concise summary of the following:\n\n${context}`;
    case "explain":
      return `${PROMPT_BASE}\n\nExplain the following in one short, plain-language paragraph:\n\n${context}`;
    default:
      return `${PROMPT_BASE}\n\nContext:\n\n${context}\n\nRequest: ${request}`;
  }
}

function editInstructionFor(action: CannedActionId | null, request: string): string {
  switch (action) {
    case "improve":
      return "Improve the writing for clarity and flow, keeping the meaning and the markdown structure.";
    case "longer":
      return "Make the content longer by elaborating on the existing ideas, without changing meaning or adding new information. Keep the markdown structure.";
    case "shorter":
      return "Make the content more concise, keeping the meaning and the markdown structure.";
    case "grammar":
      return "Fix spelling, grammar, and punctuation only. Do not change meaning, tone, or structure.";
    case "simplify":
      return "Simplify the language using clearer, more straightforward wording, without changing meaning. Keep the markdown structure.";
    default:
      return request;
  }
}

// The <markdown> sentinel is load-bearing: the host passes the prompt through
// verbatim, and the dev-harness fixture parses the block back out to fake an
// edit. Keep in sync with fixture-bridge.ts.
function buildEditPrompt(instruction: string, markdown: string): string {
  return [
    "You are a writing assistant inside a notes editor. Apply the instruction to the markdown document below.",
    "Respond with ONLY the full rewritten markdown — same dialect (GitHub-flavored), no code fences around the whole answer, no commentary.",
    "",
    `<instruction>\n${instruction}\n</instruction>`,
    `<markdown>\n${markdown}\n</markdown>`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Run bookkeeping (module-level: one editor surface, one session at a time)
// ---------------------------------------------------------------------------

type LastRun =
  | { kind: "canned"; action: CannedActionId }
  | { kind: "prompt"; text: string; intent: "generate" | "edit" };

let runCounter = 0;
// Bumped on every cancel/close; async continuations check it before touching
// the editor so a stale response can't land after the user moved on.
let runToken = 0;
let lastRun: LastRun | null = null;
// Generate-flow unwind state: history depth before the AI touched the doc,
// stream unsubscribe, and the in-flight requestId (for host-side abort).
let undoDepth = 0;
let streamOff: (() => void) | null = null;
let activeRequestId: string | null = null;

/**
 * Release the module-level session bookkeeping when the (single) editor
 * unmounts — the note switched or the surface changed. Stops the stream,
 * aborts the host-side run, and invalidates the token so a late response
 * can't touch a dead editor. Deliberately NO editor mutations: the streamed
 * ai-marked content dies with the editor (autosave froze during the run, so
 * disk never saw it).
 */
export function releaseAiSession(): void {
  runToken += 1;
  streamOff?.();
  streamOff = null;
  if (activeRequestId !== null) {
    void getBridge()?.cancelInlineAi({ requestId: activeRequestId });
    activeRequestId = null;
  }
  lastRun = null;
}

function setOptions(editor: PlateEditor, patch: Partial<AiSessionOptions>): void {
  editor.setOptions(AiSessionPlugin, patch);
}

function savedSelection(editor: PlateEditor): TRange | null {
  return editor.getOption(AiSessionPlugin, "savedSelection");
}

// ---------------------------------------------------------------------------
// Open / close
// ---------------------------------------------------------------------------

/** Open the AI menu anchored under the block holding the selection's end. */
export function openAiMenu(editor: PlateEditor): void {
  if (editor.getOption(AiSessionPlugin, "status") !== "closed") return;
  const sel = editor.selection;
  if (!sel) return;
  const blockIndex = RangeApi.end(sel).path[0];
  if (blockIndex === undefined) return;
  const entry = editor.api.node([blockIndex]);
  if (!entry) return;
  const anchor = editor.api.toDOMNode(entry[0]);
  if (!anchor) return;
  setOptions(editor, { status: "input", anchor, savedSelection: sel, error: null });
}

/**
 * Close the menu from any state, leaving the document clean: an in-flight run
 * is canceled (streamed inserts unwound), a pending generate review is
 * discarded. Suggestions already applied by the edit flow are NOT touched —
 * they belong to the review bar.
 */
export function closeAiMenu(editor: PlateEditor): void {
  const status = editor.getOption(AiSessionPlugin, "status");
  if (status === "closed") return;
  if (status === "generating" || status === "editing" || status === "classifying") {
    cancelActiveRun(editor);
  } else if (status === "review") {
    unwindGenerate(editor);
  }
  runToken += 1;
  const sel = savedSelection(editor);
  setOptions(editor, { status: "closed", anchor: null, savedSelection: null, error: null });
  lastRun = null;
  if (sel) editor.tf.select(sel);
  editor.tf.focus();
}

/** Abort the in-flight run (Escape / stop button) and return to the prompt. */
export function cancelActiveRun(editor: PlateEditor): void {
  runToken += 1;
  streamOff?.();
  streamOff = null;
  if (activeRequestId !== null) {
    void getBridge()?.cancelInlineAi({ requestId: activeRequestId });
    activeRequestId = null;
  }
  const status = editor.getOption(AiSessionPlugin, "status");
  if (status === "generating") unwindGenerate(editor);
  setOptions(editor, { status: "input", error: null });
}

/** Revert every AI-inserted delta back to the pre-run document. */
function unwindGenerate(editor: PlateEditor): void {
  while (editor.history.undos.length > undoDepth) editor.undo();
}

// ---------------------------------------------------------------------------
// Submitting
// ---------------------------------------------------------------------------

/** Free-form prompt path: classify host-side, then route. Submitting from the
 * generate review discards the pending output first (a follow-up replaces). */
export function submitAiPrompt(editor: PlateEditor, text: string): void {
  const bridge = getBridge();
  const prompt = text.trim();
  if (!bridge || prompt.length === 0) return;
  if (editor.getOption(AiSessionPlugin, "status") === "review") unwindGenerate(editor);
  const token = ++runToken;
  setOptions(editor, { status: "classifying", error: null });
  const sel = savedSelection(editor);
  const hasSelection = sel !== null && RangeApi.isExpanded(sel);
  const fallback: AiIntentResult = { intent: "generate" };
  void bridge
    .classifyAiIntent({ prompt, hasSelection })
    .catch(() => fallback)
    .then(({ intent }) => {
      if (runToken !== token) return; // canceled / closed while classifying
      lastRun = { kind: "prompt", text: prompt, intent };
      if (intent === "edit") startEdit(editor, editInstructionFor(null, prompt));
      else startGenerate(editor, null, prompt);
      return undefined;
    });
}

/** Canned action path: fixed intent, no classification round-trip. */
export function runCannedAction(editor: PlateEditor, id: CannedActionId): void {
  const action = CANNED_ACTIONS.find((a) => a.id === id);
  if (!action) return;
  lastRun = { kind: "canned", action: id };
  if (action.intent === "edit") startEdit(editor, editInstructionFor(id, ""));
  else startGenerate(editor, id, "");
}

/** Translate the selection's blocks — the AI menu's language page. Recorded
 * as a prompt lastRun so "Try again" re-runs it. */
export function runTranslate(editor: PlateEditor, language: string): void {
  const instruction = `Translate the content to ${language}, keeping the markdown structure and formatting.`;
  lastRun = { kind: "prompt", text: instruction, intent: "edit" };
  startEdit(editor, instruction);
}

/** Discard the current pending output (if any) and re-run the last request. */
export function retryLastRun(editor: PlateEditor): void {
  const run = lastRun;
  if (!run) return;
  if (editor.getOption(AiSessionPlugin, "status") === "review") unwindGenerate(editor);
  if (run.kind === "canned") runCannedAction(editor, run.action);
  else if (run.intent === "edit") startEdit(editor, editInstructionFor(null, run.text));
  else startGenerate(editor, null, run.text);
}

// ---------------------------------------------------------------------------
// Generate flow (streaming markdown parsed into blocks, transient ai mark)
// ---------------------------------------------------------------------------

function startGenerate(editor: PlateEditor, action: CannedActionId | null, request: string): void {
  const bridge = getBridge();
  if (!bridge) return;
  const sel = savedSelection(editor) ?? editor.selection;
  if (!sel) return;
  const hasSelection = RangeApi.isExpanded(sel);
  const context =
    hasSelection && action !== "continue" ? editor.api.string(sel) : editor.api.string([]);

  // Generations INSERT below the block holding the captured selection's end —
  // they never replace content (that's the edit flow's job). Deltas
  // accumulate as markdown and land as incrementally parsed blocks (#370).
  editor.tf.select(sel);
  editor.tf.collapse({ edge: "end" });
  const caretBlock = editor.selection?.anchor.path[0];
  if (caretBlock === undefined) return;

  undoDepth = editor.history.undos.length;
  const stream = createMarkdownStream(editor, caretBlock);
  const token = ++runToken;
  runCounter += 1;
  const requestId = `menu-${runCounter}`;
  activeRequestId = requestId;
  setOptions(editor, { status: "generating", error: null });

  streamOff = bridge.onAiStreamed(({ requestId: id, delta }) => {
    if (id !== requestId || delta.length === 0 || runToken !== token) return;
    stream.append(delta);
  });

  void bridge
    .generateInlineAi({ prompt: generatePromptFor(action, request, context), requestId })
    .then((result) => {
      if (runToken !== token) return undefined;
      streamOff?.();
      streamOff = null;
      activeRequestId = null;
      if (!result.ok) {
        unwindGenerate(editor);
        setOptions(editor, { status: "error", error: result.error });
        return undefined;
      }
      // Fallback for models that don't stream: land the whole reply now.
      if (stream.text().length === 0) stream.append(result.text);
      setOptions(editor, { status: "review" });
      return undefined;
    })
    .catch(() => {
      if (runToken !== token) return;
      streamOff?.();
      streamOff = null;
      activeRequestId = null;
      setOptions(editor, { status: "error", error: "AI request failed." });
    });
}

/** Keep the generated blocks: strip the highlight, close the menu. */
export function acceptGenerate(editor: PlateEditor): void {
  stripAiMarks(editor);
  editor.tf.collapse({ edge: "end" });
  const at = editor.selection;
  setOptions(editor, { status: "closed", anchor: null, savedSelection: null, error: null });
  lastRun = null;
  runToken += 1;
  if (at) editor.tf.select(at);
  editor.tf.focus();
}

/** Remove the generated text (precise undo back to the pre-run document). */
export function discardGenerate(editor: PlateEditor): void {
  unwindGenerate(editor);
  closeAiMenu(editor);
}

/** Back from the error state to the prompt. */
export function dismissAiError(editor: PlateEditor): void {
  setOptions(editor, { status: "input", error: null });
}

// ---------------------------------------------------------------------------
// Edit flow (suggestions)
// ---------------------------------------------------------------------------

/** The contiguous top-level blocks covered by the captured selection (caret =
 * its single block). Frontmatter is never an edit target. */
function editTargetPaths(editor: PlateEditor): Path[] {
  const sel = savedSelection(editor) ?? editor.selection;
  if (!sel) return [];
  const startIndex = RangeApi.start(sel).path[0];
  const endIndex = RangeApi.end(sel).path[0];
  if (startIndex === undefined || endIndex === undefined) return [];
  const paths: Path[] = [];
  for (let i = startIndex; i <= endIndex; i++) {
    const entry = editor.api.node([i]);
    if (!entry) continue;
    const [node] = entry;
    if ("type" in node && node.type === "frontmatter") continue;
    paths.push([i]);
  }
  return paths;
}

function startEdit(editor: PlateEditor, instruction: string): void {
  const bridge = getBridge();
  if (!bridge) return;
  const paths = editTargetPaths(editor);
  const nodes = paths.flatMap((path) => {
    const entry = editor.api.node(path);
    return entry ? [entry[0]] : [];
  });
  if (nodes.length === 0) {
    setOptions(editor, { status: "error", error: "Nothing to edit here." });
    return;
  }
  const markdown = serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY, value: nodes });
  const token = ++runToken;
  runCounter += 1;
  const requestId = `menu-${runCounter}`;
  activeRequestId = requestId;
  setOptions(editor, { status: "editing", error: null });

  void bridge
    .generateInlineAi({ prompt: buildEditPrompt(instruction, markdown), requestId })
    .then((result) => {
      if (runToken !== token) return undefined; // canceled / closed
      activeRequestId = null;
      if (!result.ok) {
        setOptions(editor, { status: "error", error: result.error });
        return undefined;
      }
      const parsed = parseMarkdown(result.text);
      if (!parsed.ok) {
        setOptions(editor, { status: "error", error: "The AI reply couldn't be applied." });
        return undefined;
      }
      if (!applyEditSuggestions(editor, editTargetPaths(editor), parsed.value)) {
        setOptions(editor, { status: "error", error: "The AI suggested no changes." });
        return undefined;
      }
      // Suggestions are in the document; the review bar owns them from here.
      runToken += 1;
      setOptions(editor, { status: "closed", anchor: null, savedSelection: null, error: null });
      lastRun = null;
      editor.tf.focus();
      return undefined;
    })
    .catch(() => {
      if (runToken !== token) return;
      activeRequestId = null;
      setOptions(editor, { status: "error", error: "AI request failed." });
    });
}
