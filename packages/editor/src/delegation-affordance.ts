// The delegation entry point in the editor: a quiet tooltip above the
// selection offering "Delegate…" / "Propose…" / "Ask…", and — the checkbox
// fast path — a one-click delegate when the caret sits on a task line. The
// tooltip computes from state only: a doc change hides it (typing must never
// grow chrome), a selection-only transaction shows it, and drag-selections
// defer through the same rebuild seam the hide/fold fields use, so it appears
// once on release instead of flickering under the moving head.
//
// A SELECTION NAMES ITS WRITE MODE; THE FAST PATH INHERITS THE SETTING. Both
// modes are spelled out where there is room for two words, because "will this
// land or will I review it" is exactly what a user needs to know before
// typing a prompt — and the setting is what answers it for the one-click path
// that has no room to ask. `ask` writes nothing, so it names no mode.

import { StateField, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, showTooltip, type Tooltip } from "@codemirror/view";
import { checkboxMarkerAt } from "@repo/notes/knowledge/source-lines";
import { allowsSelectionRebuild } from "./decoration-update-filter";

export type DelegationIntent = "do" | "ask";

/** Where a delegation's writes go. Spelled here rather than imported so this
 *  package keeps its one dependency; the app pins the two against each other
 *  at the call site. */
export type DelegationWriteMode = "direct" | "propose";

export interface DelegationSelection {
  from: number;
  to: number;
  text: string;
}

export interface DelegationAffordanceConfig {
  onDelegateSelection: (
    intent: DelegationIntent,
    writeMode: DelegationWriteMode,
    selection: DelegationSelection,
  ) => void;
  /** One click, no prompt: the task line's text IS the prompt. The mode comes
   *  from the setting, which is what the label below has to state. */
  onDelegateTask: (writeMode: DelegationWriteMode, task: DelegationSelection) => void;
  /** The user's default write mode, read at render — a getter, because the
   *  extension set is fixed at mount while the setting is not. */
  defaultWriteMode: () => DelegationWriteMode;
}

interface TooltipPlan {
  pos: number;
  end: number;
  actions: { label: string; run: () => void }[];
}

function planFor(state: EditorState, config: DelegationAffordanceConfig): TooltipPlan | null {
  const main = state.selection.main;
  if (!main.empty) {
    const selection: DelegationSelection = {
      from: main.from,
      to: main.to,
      text: state.sliceDoc(main.from, main.to),
    };
    return {
      pos: main.from,
      end: main.to,
      actions: [
        {
          label: "Delegate…",
          run: () => config.onDelegateSelection("do", "direct", selection),
        },
        {
          label: "Propose…",
          run: () => config.onDelegateSelection("do", "propose", selection),
        },
        { label: "Ask…", run: () => config.onDelegateSelection("ask", "direct", selection) },
      ],
    };
  }
  const line = state.doc.lineAt(main.head);
  if (checkboxMarkerAt(line.text) === null) {
    return null;
  }
  const task: DelegationSelection = { from: line.from, to: line.to, text: line.text };
  const writeMode = config.defaultWriteMode();
  return {
    pos: line.from,
    end: line.to,
    actions: [
      {
        // The label says what the click will DO, so the one affordance with no
        // room to offer a choice at least never surprises.
        label: writeMode === "propose" ? "Propose task edit" : "Delegate task",
        run: () => config.onDelegateTask(writeMode, task),
      },
    ],
  };
}

function tooltipFor(state: EditorState, config: DelegationAffordanceConfig): Tooltip | null {
  const plan = planFor(state, config);
  if (plan === null) {
    return null;
  }
  return {
    pos: plan.pos,
    end: plan.end,
    above: true,
    arrow: false,
    create: () => {
      const dom = document.createElement("div");
      dom.className = "cm-delegate-tooltip";
      for (const action of plan.actions) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "cm-delegate-button";
        button.textContent = action.label;
        // mousedown would collapse the selection before click fires.
        button.addEventListener("mousedown", (event) => event.preventDefault());
        button.addEventListener("click", (event) => {
          event.preventDefault();
          action.run();
        });
        dom.append(button);
      }
      return { dom };
    },
  };
}

export function delegationAffordanceExtension(config: DelegationAffordanceConfig): Extension {
  const field = StateField.define<Tooltip | null>({
    create: (state) => tooltipFor(state, config),
    update: (value, tr) => {
      if (tr.docChanged) {
        return null;
      }
      if (tr.selection !== undefined && allowsSelectionRebuild(tr)) {
        return tooltipFor(tr.state, config);
      }
      return value;
    },
    provide: (f) => showTooltip.from(f),
  });
  return [field, affordanceTheme];
}

// The bar IS the tooltip element — CodeMirror adds `cm-tooltip` to whatever
// dom a `create` returns — so there is no wrapper to style separately, and the
// box it sits in is the shared tooltip chrome editor-theme.ts already dresses.
// What is left here is the row of buttons.
const affordanceTheme = EditorView.theme({
  ".cm-delegate-tooltip": {
    display: "flex",
    gap: "2px",
    padding: "2px",
    boxShadow: "0 2px 8px oklch(0% 0 0 / 0.08)",
  },
  ".cm-delegate-button": {
    border: "none",
    background: "none",
    borderRadius: "6px",
    padding: "0.2em 0.6em",
    font: "inherit",
    fontSize: "0.8em",
    color: "var(--editor-fg)",
    cursor: "pointer",
  },
  ".cm-delegate-button:hover": {
    background: "var(--pm-code-btn-background-color)",
  },
});
