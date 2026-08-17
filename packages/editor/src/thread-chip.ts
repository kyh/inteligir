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
// `loading`, never as `unknown` — "no thread claims this anchor" is a claim
// only an ANSWERED query can make, and offering dismiss on an unanswered one
// invites deleting a live delegation's anchor. A selection touching the marker
// reveals the raw comment, same rule as every other folded construct.

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

export type ThreadChipStatus =
  | "queued"
  | "running"
  | "needs-approval"
  | "done"
  | "failed"
  | "archived"
  /** The app has not answered which threads this doc has yet. */
  | "loading"
  /** ANSWERED, and no thread claims this anchor (deleted db, foreign vault). */
  | "unknown";

export interface ThreadChipInfo {
  anchor: string;
  status: ThreadChipStatus;
  title: string | null;
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

const STATUS_LABELS: Record<ThreadChipStatus, string> = {
  queued: "queued",
  running: "running",
  "needs-approval": "needs approval",
  done: "done",
  failed: "failed",
  archived: "archived",
  loading: "delegation",
  unknown: "no thread",
};

/** Only a settled thread's marker may be removed — and `unknown` counts only
 *  because it is the ANSWERED "no such thread", never the unanswered one. */
const isDismissable = (status: ThreadChipStatus): boolean =>
  status === "archived" || status === "unknown";

class ThreadChipWidget extends WidgetType {
  constructor(
    readonly anchor: string,
    readonly status: ThreadChipStatus,
    readonly title: string | null,
    readonly onOpen: (anchor: string) => void,
  ) {
    super();
  }

  override eq(other: ThreadChipWidget): boolean {
    return (
      other.anchor === this.anchor && other.status === this.status && other.title === this.title
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const chip = document.createElement("span");
    chip.className = "cm-thread-chip";
    chip.dataset["status"] = this.status;
    chip.setAttribute("role", "button");
    chip.setAttribute("aria-label", `Delegation ${STATUS_LABELS[this.status]}`);

    const dot = document.createElement("span");
    dot.className = "cm-thread-chip-dot";
    chip.append(dot);

    const label = document.createElement("span");
    label.className = "cm-thread-chip-label";
    label.textContent = this.title ?? STATUS_LABELS[this.status];
    chip.append(label);

    if (this.status !== "unknown" && this.status !== "loading") {
      chip.addEventListener("click", (event) => {
        event.preventDefault();
        this.onOpen(this.anchor);
      });
    }

    if (isDismissable(this.status)) {
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
      const status: ThreadChipStatus = info?.status ?? (byAnchor === null ? "loading" : "unknown");
      ranges.push(
        Decoration.replace({
          widget: new ThreadChipWidget(marker.anchor, status, info?.title ?? null, config.onOpen),
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

const running = "var(--chip-running)";

// Same light/dark carrier pattern as editor-theme.ts: light tokens on the
// editor root, dark under the media query guarded against an explicit light
// choice, and again under the explicit data-theme="dark" override.
const chipLightTokens: Record<string, string> = {
  "--chip-border": "oklch(88% 0.01 260)",
  "--chip-fg": "oklch(50% 0.03 257)",
  "--chip-queued": "oklch(72% 0.015 260)",
  "--chip-running": "oklch(62% 0.1 240)",
  "--chip-needs-approval": "oklch(70% 0.13 75)",
  "--chip-done": "oklch(62% 0.1 150)",
  "--chip-failed": "oklch(58% 0.16 25)",
  "--chip-muted": "oklch(80% 0.01 260)",
};

const chipDarkTokens: Record<string, string> = {
  "--chip-border": "oklch(38% 0.015 260)",
  "--chip-fg": "oklch(68% 0.025 257)",
  "--chip-queued": "oklch(55% 0.02 260)",
  "--chip-running": "oklch(70% 0.1 240)",
  "--chip-needs-approval": "oklch(75% 0.12 75)",
  "--chip-done": "oklch(68% 0.1 150)",
  "--chip-failed": "oklch(66% 0.15 25)",
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
  '.cm-thread-chip[data-status="unknown"], .cm-thread-chip[data-status="loading"]': {
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
  '.cm-thread-chip[data-status="queued"] .cm-thread-chip-dot': {
    background: "var(--chip-queued)",
  },
  '.cm-thread-chip[data-status="running"] .cm-thread-chip-dot': {
    background: running,
    animation: "cm-thread-chip-pulse 1.6s ease-in-out infinite",
  },
  '.cm-thread-chip[data-status="needs-approval"] .cm-thread-chip-dot': {
    background: "var(--chip-needs-approval)",
  },
  '.cm-thread-chip[data-status="done"] .cm-thread-chip-dot': {
    background: "var(--chip-done)",
  },
  '.cm-thread-chip[data-status="failed"] .cm-thread-chip-dot': {
    background: "var(--chip-failed)",
  },
  "@keyframes cm-thread-chip-pulse": {
    "0%, 100%": { opacity: "1" },
    "50%": { opacity: "0.35" },
  },
  "@media (prefers-reduced-motion: reduce)": {
    '.cm-thread-chip[data-status="running"] .cm-thread-chip-dot': {
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
