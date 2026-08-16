// Floating review bar for an AI suggestion session — appears whenever the
// document holds unresolved (transient) suggestions and derives everything
// from the document itself, so it survives undo (nodes gone → bar gone)
// without its own lifecycle bookkeeping. Per-change accept/reject with ‹ ›
// navigation, plus Accept all / Reject all.

import * as React from "react";
import { CheckCheckIcon, CheckIcon, ChevronLeft, ChevronRight, XIcon } from "lucide-react";
import { useEditorRef, useEditorSelector, usePluginOption } from "platejs/react";

import { suggestionPlugin } from "@repo/editor/ai/suggestion-kit";
import {
  firstSuggestionNode,
  resolveAllSuggestions,
  resolveSuggestion,
  transientSuggestionIds,
} from "@repo/editor/ai/suggestions";
import { BarButton } from "@repo/editor/toolbar-button";

export function SuggestionReviewBar() {
  const editor = useEditorRef();
  // Joined string keeps the selector's return referentially stable across
  // unrelated document changes (arrays would re-render every keystroke).
  const idsKey = useEditorSelector((e) => transientSuggestionIds(e).join("\u0000"), []);
  const ids = React.useMemo(() => (idsKey.length > 0 ? idsKey.split("\u0000") : []), [idsKey]);
  const activeId = usePluginOption(suggestionPlugin, "activeId");

  const currentIndex = Math.max(
    0,
    ids.findIndex((id) => id === activeId),
  );
  const currentId = ids[currentIndex] ?? null;

  const goTo = (index: number) => {
    const id = ids[(index + ids.length) % ids.length];
    if (id === undefined) return;
    editor.setOption(suggestionPlugin, "activeId", id);
    const node = firstSuggestionNode(editor, id);
    if (!node) return;
    const dom = editor.api.toDOMNode(node);
    dom?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  if (ids.length === 0) return null;

  return (
    <div
      className="absolute left-1/2 top-3 z-40 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-surface-4 animate-in fade-in-0 zoom-in-95"
      onMouseDown={(event) => event.preventDefault()}
    >
      <span className="whitespace-nowrap px-1.5 text-xs text-muted-foreground">
        AI suggestions · {currentIndex + 1}/{ids.length}
      </span>
      <BarButton title="Previous change" onClick={() => goTo(currentIndex - 1)}>
        <ChevronLeft />
      </BarButton>
      <BarButton title="Next change" onClick={() => goTo(currentIndex + 1)}>
        <ChevronRight />
      </BarButton>
      <div className="mx-0.5 h-5 w-px shrink-0 bg-border" />
      <BarButton
        variant="primary"
        title="Accept this change"
        onClick={() => {
          if (currentId !== null) resolveSuggestion(editor, currentId, "accept");
        }}
      >
        <CheckIcon /> Accept
      </BarButton>
      <BarButton
        variant="danger"
        title="Reject this change"
        onClick={() => {
          if (currentId !== null) resolveSuggestion(editor, currentId, "reject");
        }}
      >
        <XIcon /> Reject
      </BarButton>
      <div className="mx-0.5 h-5 w-px shrink-0 bg-border" />
      <BarButton
        variant="primary"
        title="Accept all changes"
        onClick={() => resolveAllSuggestions(editor, "accept")}
      >
        <CheckCheckIcon /> All
      </BarButton>
      <BarButton
        variant="danger"
        title="Reject all changes"
        onClick={() => resolveAllSuggestions(editor, "reject")}
      >
        <XIcon /> All
      </BarButton>
    </div>
  );
}
