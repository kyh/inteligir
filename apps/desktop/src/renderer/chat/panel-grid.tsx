import { useCallback, useEffect, useMemo } from "react";
import { MessageSquareIcon, PlusIcon, XIcon } from "lucide-react";
import {
  GridLayout,
  useContainerWidth,
  type Layout,
  type LayoutItem,
} from "react-grid-layout";
import "react-grid-layout/css/styles.css";

import { cn } from "@repo/ui/lib/utils";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@repo/ui/components/ai-elements/conversation";

import { ArtifactViewer } from "@/renderer/chat/artifact-viewer";
import { ChatActivityRow, ChatMessageView } from "@/renderer/chat/chat-message";
import { Composer } from "@/renderer/chat/composer";
import { getBridge } from "@/renderer/lib/bridge";
import { useAgentStore } from "@/renderer/stores/agent-store";
import { initShell, useShellStore } from "@/renderer/stores/shell-store";
import { useVoiceStore } from "@/renderer/stores/voice-store";
import { isArtifactWidget, type Widget } from "@/shared/shell";
import type { ArtifactUpsertInput } from "@/shared/artifacts";

// A blank, user-editable note panel. The simplest thing a user can add to the
// workspace without authoring a spec — a multi-line field bound to state and
// persisted like any other widget.
function noteStarter(): ArtifactUpsertInput {
  return {
    title: "Note",
    spec: {
      root: "root",
      elements: {
        root: { type: "Stack", props: { gap: "sm" }, children: ["body"] },
        body: {
          type: "Textarea",
          props: { placeholder: "Type a note…", value: { $bindState: "/text" }, rows: 6 },
        },
      },
      state: { text: "" },
    },
    state: { text: "" },
  };
}

// ---------------------------------------------------------------------------
// Reshapeable workspace ("shell")
//
// A 12-column grid of widgets. Each widget owns its grid geometry (persisted
// in shell.json), so the layout survives reloads. The chat widget is pinned:
// movable/resizable but never removable. Artifact widgets can be dragged,
// resized, and closed; the agent creates/edits them via the manage_ui tool.
// ---------------------------------------------------------------------------

function widgetToLayoutItem(w: Widget): LayoutItem {
  return { i: w.id, ...w.geometry };
}

// ---------------------------------------------------------------------------
// Panel shell
// ---------------------------------------------------------------------------

function Panel({
  title,
  children,
  bodyClassName,
  onRemove,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  bodyClassName?: string;
  onRemove?: () => void;
}) {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-border bg-card/40 shadow-lg backdrop-blur-md">
      <div className="panel-drag-handle flex shrink-0 cursor-move items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <span className="truncate text-xs font-medium text-muted-foreground">{title}</span>
        {onRemove ? (
          <button
            type="button"
            aria-label="Remove panel"
            className="shrink-0 rounded p-0.5 text-muted-foreground/60 hover:bg-muted hover:text-foreground"
            // Stop the grid drag handler from swallowing the click.
            onMouseDown={(e) => e.stopPropagation()}
            onClick={onRemove}
          >
            <XIcon className="size-3.5" />
          </button>
        ) : null}
      </div>
      <div className={cn("min-h-0 flex-1 overflow-auto", bodyClassName)}>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conversation panel
// ---------------------------------------------------------------------------

function ConversationPanel() {
  const messages = useAgentStore((s) => s.messages);
  const appState = useAgentStore((s) => s.appState);
  const busy = appState.phase === "ready" && appState.agent === "busy";

  const voiceState = useVoiceStore((s) => s.state);
  const currentTranscript =
    voiceState.kind === "listening" ? voiceState.currentTranscript : "";

  return (
    <Panel title="Conversation" bodyClassName="flex flex-col">
      <Conversation className="min-h-0 flex-1 px-3 pt-2">
        <ConversationContent className="gap-1 p-0 pb-2">
          {messages.length === 0 && !busy ? (
            <ConversationEmptyState
              title="No messages yet"
              description="Start a conversation or speak to begin."
              icon={<MessageSquareIcon className="size-6" />}
            />
          ) : (
            <>
              {messages.map((msg) => (
                <ChatMessageView key={msg.id} message={msg} />
              ))}
              <ChatActivityRow messages={messages} busy={busy} />
            </>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {currentTranscript && (
        <div className="px-3 pb-1">
          <p className="truncate text-xs italic text-muted-foreground">
            &ldquo;{currentTranscript}&hellip;&rdquo;
          </p>
        </div>
      )}

      <Composer />
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

export function PanelGrid() {
  const { width, containerRef } = useContainerWidth();

  useEffect(() => {
    initShell();
  }, []);
  const widgets = useShellStore((s) => s.widgets);
  const loading = useShellStore((s) => s.loading);

  const layout = useMemo(() => widgets.map(widgetToLayoutItem), [widgets]);

  // Persist geometry on drag/resize. Main compares against stored geometry and
  // only broadcasts on a real change, so the mount-time callback is a no-op.
  const handleLayoutChange = useCallback((next: Layout) => {
    const geometries: Record<string, LayoutItem> = {};
    for (const item of next as LayoutItem[]) {
      geometries[item.i] = {
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
        ...(item.minW !== undefined ? { minW: item.minW } : {}),
        ...(item.minH !== undefined ? { minH: item.minH } : {}),
      } as LayoutItem;
    }
    void getBridge()?.setWidgetGeometry(geometries);
  }, []);

  const removeWidget = useCallback((id: string) => {
    void getBridge()?.removeWidget(id);
  }, []);

  const addNote = useCallback(() => {
    void getBridge()?.addArtifact(noteStarter());
  }, []);

  const ready = width > 0 && !loading;

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {ready && (
        <button
          type="button"
          onClick={addNote}
          className="absolute right-1 top-0 z-10 flex items-center gap-1 rounded-md border border-border bg-card/60 px-2 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur-md hover:text-foreground"
        >
          <PlusIcon className="size-3.5" />
          Add panel
        </button>
      )}
      {ready && (
        <GridLayout
          width={width}
          layout={layout}
          onLayoutChange={handleLayoutChange}
          gridConfig={{ cols: 12, rowHeight: 46, margin: [10, 10], containerPadding: [0, 0] }}
          dragConfig={{ enabled: true, bounded: false, handle: ".panel-drag-handle" }}
          resizeConfig={{ enabled: true, handles: ["se", "e", "s"] }}
        >
          {widgets.map((widget) => (
            <div key={widget.id}>
              {isArtifactWidget(widget) ? (
                <Panel title={widget.title} onRemove={() => removeWidget(widget.id)}>
                  <ArtifactViewer widget={widget} />
                </Panel>
              ) : (
                <ConversationPanel />
              )}
            </div>
          ))}
        </GridLayout>
      )}
    </div>
  );
}
