// The live delegation chip: a thread marker in the buffer renders as a small
// status chip instead of its raw bytes. Which spans ARE markers is
// @repo/notes/markdown/thread-marker's syntax-aware answer, never a regex over
// the text — the same characters inside a fence or inline code are the user's
// literal text, and a chip there would hide it while a dismiss there would
// delete it.
//
// Two invariants hold this together. Status NEVER touches the buffer: thread
// state arrives as a StateEffect, so the only write this extension makes is a
// dismiss. And a chip whose threads the app has not fetched yet renders as
// LOADING, never as "no thread claims this anchor" — that is a claim only an
// ANSWERED query can make, and offering dismiss on an unanswered one invites
// deleting a live delegation's anchor. A selection touching the marker
// reveals the raw comment, same rule as every other folded construct.
//
// WHAT A THREAD IS DOING IS NOT THIS PACKAGE'S VOCABULARY. The app derives it
// once, for every surface that shows it, and hands this widget the rendering:
// a word, a tone, and whether the marker may be removed. A status union
// declared here would be a second answer to a question the palette and the
// chat dock also ask — and a chip reading "running" beside a palette row
// reading "idle" is that duplication becoming visible.

import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import {
  findThreadMarkers,
  threadMarkerRemoval,
  type ThreadMarker,
} from "@repo/notes/markdown/thread-marker";
import { allowsSelectionRebuild } from "./decoration-update-filter";

/** How a chip is PAINTED — the editor's own vocabulary, because the editor
 *  owns the palette. What each one means about a thread is the app's. */
export type ThreadChipTone = "neutral" | "busy" | "attention" | "positive" | "negative" | "muted";

export interface ThreadChipInfo {
  anchor: string;
  tone: ThreadChipTone;
  /** The app's own word for what this thread is doing. Rendered verbatim in
   *  the chip's accessible name, and as its label when the thread is
   *  untitled. */
  activity: string;
  title: string | null;
  /** Only a settled thread's marker may be removed; the app decides which of
   *  its threads are settled. */
  dismissable: boolean;
}

/** What the app knows about this doc's threads. `loading` is not an empty
 *  list: the two differ precisely in whether dismiss may be offered. */
export type ThreadChipState =
  | { kind: "loading" }
  | { kind: "ready"; chips: readonly ThreadChipInfo[] };

export interface ThreadChipConfig {
  /** A chip was clicked: open that anchor's thread in the chat panel. */
  onOpen: (anchor: string) => void;
}

export const setThreadChips = StateEffect.define<ThreadChipState>();

/** The two chips the app cannot describe, because both are facts about its
 *  ANSWER rather than about a thread: the query has not landed, and it landed
 *  claiming nothing for this anchor (deleted db, foreign vault). Only the
 *  second may be dismissed, and neither opens anything. */
const NO_INFO: Record<ThreadChipState["kind"], Omit<ThreadChipInfo, "anchor">> = {
  loading: { tone: "muted", activity: "delegation", title: null, dismissable: false },
  ready: { tone: "muted", activity: "no thread", title: null, dismissable: true },
};

class ThreadChipWidget extends WidgetType {
  constructor(
    readonly info: ThreadChipInfo,
    /** Null when no thread claims this anchor — nothing to open. */
    readonly onOpen: ((anchor: string) => void) | null,
  ) {
    super();
  }

  override eq(other: ThreadChipWidget): boolean {
    return (
      other.info.anchor === this.info.anchor &&
      other.info.tone === this.info.tone &&
      other.info.activity === this.info.activity &&
      other.info.title === this.info.title &&
      other.info.dismissable === this.info.dismissable &&
      (other.onOpen === null) === (this.onOpen === null)
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const { anchor, tone, activity, title, dismissable } = this.info;
    const chip = document.createElement("span");
    chip.className =
      this.onOpen === null ? "cm-thread-chip cm-thread-chip-inert" : "cm-thread-chip";
    chip.dataset["tone"] = tone;
    chip.setAttribute("role", "button");
    chip.setAttribute("aria-label", `Delegation ${activity}`);

    const dot = document.createElement("span");
    dot.className = "cm-thread-chip-dot";
    chip.append(dot);

    const label = document.createElement("span");
    label.className = "cm-thread-chip-label";
    label.textContent = title ?? activity;
    chip.append(label);

    const onOpen = this.onOpen;
    if (onOpen !== null) {
      chip.addEventListener("click", (event) => {
        event.preventDefault();
        onOpen(anchor);
      });
    }

    if (dismissable) {
      const dismiss = document.createElement("button");
      dismiss.type = "button";
      dismiss.className = "cm-thread-chip-dismiss";
      dismiss.textContent = "×";
      dismiss.setAttribute("aria-label", "Remove delegation marker");
      dismiss.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        // THIS chip's marker, resolved from where the widget currently sits —
        // never the first marker carrying the token. Two anchors can share a
        // token only through a corrupt file, but a chip that deletes a range
        // it does not occupy is a data-loss bug either way.
        dismissMarkerAt(view, view.posAtDOM(chip));
      });
      chip.append(dismiss);
    }
    return chip;
  }

  // The chip owns every event inside it; the editor must not move the caret
  // into the (replaced) marker range on a click.
  override ignoreEvent(): boolean {
    return true;
  }
}

function dismissMarkerAt(view: EditorView, pos: number): void {
  const content = view.state.doc.toString();
  const marker = findThreadMarkers(content).find((entry) => pos >= entry.from && pos <= entry.to);
  if (marker === undefined) {
    return;
  }
  const removal = threadMarkerRemoval(content, marker);
  view.dispatch({
    changes: { from: removal.from, to: removal.to },
    userEvent: "delete.thread-chip",
  });
}

interface ChipFieldValue {
  state: ThreadChipState;
  decorations: DecorationSet;
}

function selectionTouches(state: EditorState, marker: ThreadMarker): boolean {
  return state.selection.ranges.some((range) => range.from <= marker.to && range.to >= marker.from);
}

const LOADING: ThreadChipState = { kind: "loading" };

export function threadChipsExtension(config: ThreadChipConfig): Extension {
  const build = (editorState: EditorState, chipState: ThreadChipState): DecorationSet => {
    const byAnchor =
      chipState.kind === "ready"
        ? new Map(chipState.chips.map((chip) => [chip.anchor, chip]))
        : null;
    const ranges: Range<Decoration>[] = [];
    for (const marker of findThreadMarkers(editorState.doc.toString())) {
      if (selectionTouches(editorState, marker)) {
        continue;
      }
      const info = byAnchor?.get(marker.anchor);
      ranges.push(
        Decoration.replace({
          widget: new ThreadChipWidget(
            info ?? { anchor: marker.anchor, ...NO_INFO[chipState.kind] },
            info === undefined ? null : config.onOpen,
          ),
        }).range(marker.from, marker.to),
      );
    }
    return Decoration.set(ranges, true);
  };

  const field = StateField.define<ChipFieldValue>({
    create: (state) => ({ state: LOADING, decorations: build(state, LOADING) }),
    update: (value, tr) => {
      let chipState = value.state;
      let chipsChanged = false;
      for (const effect of tr.effects) {
        if (effect.is(setThreadChips)) {
          chipState = effect.value;
          chipsChanged = true;
        }
      }
      if (
        tr.docChanged ||
        chipsChanged ||
        (tr.selection !== undefined && allowsSelectionRebuild(tr))
      ) {
        return { state: chipState, decorations: build(tr.state, chipState) };
      }
      return { state: chipState, decorations: value.decorations.map(tr.changes) };
    },
    provide: (f) => EditorView.decorations.from(f, (value) => value.decorations),
  });

  return [field, chipTheme];
}

const busy = "var(--chip-busy)";

// Same light/dark carrier pattern as editor-theme.ts: light tokens on the
// editor root, dark under the media query guarded against an explicit light
// choice, and again under the explicit data-theme="dark" override.
const chipLightTokens: Record<string, string> = {
  "--chip-border": "oklch(88% 0.01 260)",
  "--chip-fg": "oklch(50% 0.03 257)",
  "--chip-neutral": "oklch(72% 0.015 260)",
  "--chip-busy": "oklch(62% 0.1 240)",
  "--chip-attention": "oklch(70% 0.13 75)",
  "--chip-positive": "oklch(62% 0.1 150)",
  "--chip-negative": "oklch(58% 0.16 25)",
  "--chip-muted": "oklch(80% 0.01 260)",
};

const chipDarkTokens: Record<string, string> = {
  "--chip-border": "oklch(38% 0.015 260)",
  "--chip-fg": "oklch(68% 0.025 257)",
  "--chip-neutral": "oklch(55% 0.02 260)",
  "--chip-busy": "oklch(70% 0.1 240)",
  "--chip-attention": "oklch(75% 0.12 75)",
  "--chip-positive": "oklch(68% 0.1 150)",
  "--chip-negative": "oklch(66% 0.15 25)",
  "--chip-muted": "oklch(45% 0.015 260)",
};

const chipTheme = EditorView.theme({
  "&": chipLightTokens,
  "@media (prefers-color-scheme: dark)": {
    ':root:not([data-theme="light"]) &': chipDarkTokens,
  },
  ':root[data-theme="dark"] &': chipDarkTokens,

  ".cm-thread-chip": {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.35em",
    maxWidth: "16em",
    padding: "0.05em 0.6em",
    border: "1px solid var(--chip-border)",
    borderRadius: "999px",
    fontSize: "0.75em",
    lineHeight: "1.6",
    color: "var(--chip-fg)",
    cursor: "pointer",
    userSelect: "none",
    verticalAlign: "baseline",
  },
  ".cm-thread-chip-inert": {
    cursor: "default",
  },
  ".cm-thread-chip-label": {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  ".cm-thread-chip-dot": {
    width: "0.5em",
    height: "0.5em",
    flexShrink: "0",
    borderRadius: "999px",
    background: "var(--chip-muted)",
  },
  '.cm-thread-chip[data-tone="neutral"] .cm-thread-chip-dot': {
    background: "var(--chip-neutral)",
  },
  '.cm-thread-chip[data-tone="busy"] .cm-thread-chip-dot': {
    background: busy,
    animation: "cm-thread-chip-pulse 1.6s ease-in-out infinite",
  },
  '.cm-thread-chip[data-tone="attention"] .cm-thread-chip-dot': {
    background: "var(--chip-attention)",
  },
  '.cm-thread-chip[data-tone="positive"] .cm-thread-chip-dot': {
    background: "var(--chip-positive)",
  },
  '.cm-thread-chip[data-tone="negative"] .cm-thread-chip-dot': {
    background: "var(--chip-negative)",
  },
  "@keyframes cm-thread-chip-pulse": {
    "0%, 100%": { opacity: "1" },
    "50%": { opacity: "0.35" },
  },
  "@media (prefers-reduced-motion: reduce)": {
    '.cm-thread-chip[data-tone="busy"] .cm-thread-chip-dot': {
      animation: "none",
    },
  },
  ".cm-thread-chip-dismiss": {
    border: "none",
    background: "none",
    padding: "0",
    color: "var(--chip-fg)",
    font: "inherit",
    cursor: "pointer",
    opacity: "0.7",
  },
  ".cm-thread-chip-dismiss:hover": {
    opacity: "1",
  },
});
