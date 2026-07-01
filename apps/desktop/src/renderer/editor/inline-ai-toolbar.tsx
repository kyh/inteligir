import { useEffect, useState, type ReactNode } from "react";
import { CheckIcon, Loader2Icon, SparklesIcon, XIcon } from "lucide-react";
import { useEditorRef } from "platejs/react";

import { cn } from "@repo/ui/lib/utils";

import { useInlineAi, type InlineAiStatus } from "@/renderer/editor/inline-ai";

// Track the current selection's viewport rect so the floating bar can anchor to
// it. Re-reads on selection change and on any status transition (the pending
// text is programmatically selected, so its rect appears then).
function useSelectionRect(status: InlineAiStatus): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    const update = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) {
        setRect(null);
        return;
      }
      // Idle only wants a real (non-collapsed) selection to offer edit actions.
      if (status.kind === "idle" && sel.isCollapsed) {
        setRect(null);
        return;
      }
      const r = sel.getRangeAt(0).getBoundingClientRect();
      setRect(r.width > 0 || r.height > 0 ? r : null);
    };
    update();
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, [status]);
  return rect;
}

function FloatingBar({ rect, children }: { rect: DOMRect; children: ReactNode }) {
  // Above the selection, horizontally centred, clamped to the viewport.
  const left = Math.min(Math.max(rect.left + rect.width / 2, 120), window.innerWidth - 120);
  const top = Math.max(rect.top - 44, 8);
  return (
    <div
      style={{ position: "fixed", top, left, transform: "translateX(-50%)" }}
      className="z-50 flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
      onMouseDown={(e) => e.preventDefault()}
    >
      {children}
    </div>
  );
}

function BarButton({
  onClick,
  children,
  variant = "default",
}: {
  onClick: () => void;
  children: ReactNode;
  variant?: "default" | "primary" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
        variant === "default" && "text-foreground hover:bg-accent",
        variant === "primary" && "text-primary hover:bg-primary/10",
        variant === "danger" && "text-muted-foreground hover:bg-muted hover:text-destructive",
        "[&_svg]:size-3.5",
      )}
    >
      {children}
    </button>
  );
}

/**
 * The editor's inline-AI surface: a floating toolbar over a text selection
 * (Improve / Shorten / Fix grammar), a "Generating…" chip while the isolated
 * agent responds, and an Accept / Discard bar over the proposed text. Slash
 * commands (Continue writing / Summarize) route into the same flow via the
 * shared store below.
 */
export function InlineAiToolbar() {
  const editor = useEditorRef();
  const controller = useInlineAi(editor);
  const { status, run, accept, discard, dismissError } = controller;

  // Let slash commands drive the same controller (they can't call the hook).
  useEffect(() => registerInlineAiRunner(run), [run]);

  const rect = useSelectionRect(status);
  if (!rect) return null;

  if (status.kind === "idle") {
    return (
      <FloatingBar rect={rect}>
        <BarButton variant="primary" onClick={() => run("improve")}>
          <SparklesIcon /> Improve
        </BarButton>
        <BarButton onClick={() => run("shorter")}>Shorten</BarButton>
        <BarButton onClick={() => run("grammar")}>Fix grammar</BarButton>
      </FloatingBar>
    );
  }
  if (status.kind === "loading") {
    return (
      <FloatingBar rect={rect}>
        <span className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
          <Loader2Icon className="size-3.5 animate-spin" /> Generating…
        </span>
      </FloatingBar>
    );
  }
  if (status.kind === "pending") {
    return (
      <FloatingBar rect={rect}>
        <BarButton variant="primary" onClick={accept}>
          <CheckIcon /> Accept
        </BarButton>
        <BarButton variant="danger" onClick={discard}>
          <XIcon /> Discard
        </BarButton>
        <BarButton onClick={() => run(status.action)}>Retry</BarButton>
      </FloatingBar>
    );
  }
  return (
    <FloatingBar rect={rect}>
      <span className="px-1 text-xs text-destructive">{status.message}</span>
      <BarButton variant="danger" onClick={dismissError}>
        <XIcon />
      </BarButton>
    </FloatingBar>
  );
}

// A tiny module-level bridge so slash-menu items (which run outside React) can
// trigger the AI flow owned by the mounted toolbar.
let activeRunner: ((action: Parameters<ReturnType<typeof useInlineAi>["run"]>[0]) => void) | null =
  null;

function registerInlineAiRunner(run: typeof activeRunner): () => void {
  activeRunner = run;
  return () => {
    if (activeRunner === run) activeRunner = null;
  };
}

export function triggerInlineAi(action: "continue" | "summarize"): void {
  activeRunner?.(action);
}
