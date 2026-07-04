// THE shared MarkdownPlugin instance — the single configure call both editors
// (headless mirror via base-kit, live editor) consume, so the serialization
// brain is shared by construction. The kit-parity test asserts both editors'
// getOptions(MarkdownPlugin) resolve to these same objects.

import { KEYS } from "platejs";
import { MarkdownPlugin } from "@platejs/markdown";

import { AI_MARK } from "@renderer/editor/ai/ai-mark";
import { shouldSerializeNode } from "@renderer/editor/ai/transient";
import { MD_REMARK_PLUGINS } from "@renderer/editor/markdown/md-plugins";
import { MD_RULES } from "@renderer/editor/markdown/md-rules";
import { WIKI_INPUT_KEY } from "@renderer/editor/wiki-input-key";

export const MarkdownKit = [
  MarkdownPlugin.configure({
    options: {
      // Transient nodes never serialize. Two mechanisms:
      // - disallowedNodes drops WHOLE nodes: the inline-AI streaming mark and
      //   the combobox trigger elements (`/`, `:`, and `[[` inputs are UI
      //   state — an autosave firing mid-combobox must skip them structurally,
      //   never hit the serializer's "Unreachable code" fallback).
      // - allowNode.serialize handles suggestion (track-changes) marks, which
      //   need per-TYPE treatment: pending INSERTIONS are dropped, but
      //   deletion-marked text is the user's ORIGINAL content and must stay
      //   (a blanket disallow would lose it). See ai/transient.ts.
      // - plainMarks strips the default `suggestion` mark rule's
      //   <suggestion> JSX wrapper from the kept (remove/update) text — the
      //   bytes are the plain original text.
      disallowedNodes: [AI_MARK, KEYS.slashInput, KEYS.emojiInput, WIKI_INPUT_KEY],
      allowNode: { serialize: shouldSerializeNode },
      plainMarks: [KEYS.suggestion],
      remarkPlugins: MD_REMARK_PLUGINS,
      rules: MD_RULES,
    },
  }),
];
