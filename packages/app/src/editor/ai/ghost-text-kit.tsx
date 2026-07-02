// Ghost-text copilot kit — wires the GhostTextMachine to Plate: editor ops
// feed the machine, the machine drives plugin render state, Tab accepts,
// Escape dismisses, blur cancels. The ghost itself is PLUGIN STATE rendered
// after the caret block's children (never a document node), so it has zero
// serialization surface by construction; only Tab-accept inserts real text.
//
// Trigger technique (render.belowNodes ghost, block-end gating) adapted from
// @platejs/ai's CopilotPlugin (MIT); the transport is ours (pi over Bridge).

import * as React from "react";
import { KEYS, NodeApi, RangeApi, type PluginConfig } from "platejs";
import { createTPlatePlugin, usePath, usePluginOption, type PlateEditor } from "platejs/react";
import { serializeMd } from "@platejs/markdown";

import { getBridge } from "@repo/app/lib/bridge";
import { AiSessionPlugin } from "@repo/app/editor/ai/ai-session";
import { GhostTextMachine } from "@repo/app/editor/ai/ghost-text-machine";
import { hasTransientAiState } from "@repo/app/editor/ai/transient";
import { MD_STRINGIFY } from "@repo/app/editor/markdown/markdown-doc";
import { useAiSettingsStore } from "@repo/app/stores/ai-settings-store";

const DEBOUNCE_MS = 600;

// Blocks the ghost never fires in: literal content (code, frontmatter).
const EXCLUDED_BLOCKS = new Set<string>([KEYS.codeBlock, KEYS.codeLine, "frontmatter"]);
// Open combobox inputs (slash / emoji) — typing there must not trigger.
const COMBOBOX_INPUTS = new Set<string>([KEYS.slashInput, KEYS.emojiInput]);

type GhostTextOptions = {
  /** Path key ("0.1"-style) of the block the ghost renders after. */
  anchorKey: string | null;
  text: string | null;
};

const machines = new WeakMap<PlateEditor, GhostTextMachine>();

function canTrigger(editor: PlateEditor): boolean {
  if (!editor.api.isFocused()) return false;
  const sel = editor.selection;
  if (!sel || RangeApi.isExpanded(sel)) return false;
  if (editor.getOption(AiSessionPlugin, "status") !== "closed") return false;
  if (hasTransientAiState(editor)) return false;
  if (!editor.api.isAt({ end: true })) return false;
  const block = editor.api.block();
  if (!block) return false;
  if (NodeApi.string(block[0]).trim().length === 0) return false;
  const insideExcluded = editor.api.above({
    at: sel,
    match: (n) => "type" in n && typeof n.type === "string" && EXCLUDED_BLOCKS.has(n.type),
  });
  if (insideExcluded || ("type" in block[0] && EXCLUDED_BLOCKS.has(block[0].type))) return false;
  const comboboxOpen = editor.api.some({
    at: [],
    match: (n) => "type" in n && typeof n.type === "string" && COMBOBOX_INPUTS.has(n.type),
  });
  return !comboboxOpen;
}

function buildGhostPrompt(blockMd: string): string {
  return [
    "You are an inline writing autocompleter in a notes editor.",
    "Continue the text naturally from where it ends. Respond with ONLY the continuation:",
    "- plain text, no markdown syntax, no surrounding quotes",
    "- at most one short sentence; stop at a natural punctuation mark",
    "- do not repeat any of the given text",
    '- reply with just "0" if there is nothing sensible to add',
    "",
    "<text>",
    blockMd,
    "</text>",
  ].join("\n");
}

function createMachine(editor: PlateEditor): GhostTextMachine {
  return new GhostTextMachine(
    {
      schedule: (fn, ms) => {
        const timer = setTimeout(fn, ms);
        return () => clearTimeout(timer);
      },
      canTrigger: () => canTrigger(editor),
      getPrompt: () => {
        const entry = editor.api.block({ highest: true });
        if (!entry) return null;
        const md = serializeMd(editor, {
          remarkStringifyOptions: MD_STRINGIFY,
          value: [entry[0]],
        }).trim();
        return md.length > 0 ? buildGhostPrompt(md) : null;
      },
      request: async (prompt, requestId) => {
        const bridge = getBridge();
        if (!bridge) return { ok: false, error: "No bridge." };
        return bridge.generateGhostText({ prompt, requestId });
      },
      cancelRequest: (requestId) => {
        void getBridge()?.cancelGhostText({ requestId });
      },
      show: (text) => {
        const block = editor.api.block();
        if (!block) return;
        editor.setOptions(GhostTextPlugin, { anchorKey: block[1].join("."), text });
      },
      hide: () => {
        editor.setOptions(GhostTextPlugin, { anchorKey: null, text: null });
      },
      insert: (text) => {
        editor.tf.insertText(text);
      },
    },
    DEBOUNCE_MS,
  );
}

function GhostTextWrapper({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <GhostTextContent />
    </>
  );
}

function GhostTextContent() {
  const anchorKey = usePluginOption(GhostTextPlugin, "anchorKey");
  const text = usePluginOption(GhostTextPlugin, "text");
  const path = usePath();
  if (anchorKey === null || text === null || !path || path.join(".") !== anchorKey) return null;
  return (
    <span
      contentEditable={false}
      className="pointer-events-none select-none whitespace-pre-wrap text-muted-foreground/70"
    >
      {text}
    </span>
  );
}

const GhostTextPlugin = createTPlatePlugin<PluginConfig<"ghostText", GhostTextOptions>>({
  key: "ghostText",
  options: { anchorKey: null, text: null },
  render: {
    belowNodes: ({ editor, element }) => {
      if (editor.api.isInline(element)) return;
      return GhostTextWrapper;
    },
  },
  handlers: {
    onKeyDown: ({ editor, event }) => {
      const machine = machines.get(editor);
      if (!machine) return;
      if (event.key === "Tab" && !event.shiftKey && machine.onTab()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key === "Escape" && machine.onEscape()) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    onBlur: ({ editor }) => {
      machines.get(editor)?.onBlur();
    },
  },
  useHooks: ({ editor }) => {
    const enabled = useAiSettingsStore((s) => s.ghostTextEnabled);
    const init = useAiSettingsStore((s) => s.init);
    React.useEffect(() => {
      void init();
    }, [init]);
    React.useEffect(() => {
      if (!enabled) return;
      const machine = createMachine(editor);
      machines.set(editor, machine);
      return () => {
        machine.dispose();
        machines.delete(editor);
        editor.setOptions(GhostTextPlugin, { anchorKey: null, text: null });
      };
    }, [editor, enabled]);
  },
}).overrideEditor(({ editor, tf: { apply } }) => ({
  transforms: {
    apply(operation) {
      apply(operation);
      const machine = machines.get(editor);
      if (!machine) return;
      if (operation.type === "set_selection") {
        // Selection ops inside a content batch (every keystroke emits one)
        // are typing, not caret navigation — the content op already handled
        // rescheduling.
        const contentBatch = editor.operations.some((op) => op.type !== "set_selection");
        if (!contentBatch) machine.onCaretMove();
        return;
      }
      machine.onDocChange();
    },
  },
}));

export const GhostTextKit = [GhostTextPlugin];
