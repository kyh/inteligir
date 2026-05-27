import { useCallback, useEffect, useState } from "react";
import { MessageSquareIcon } from "lucide-react";
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

import { ChatActivityRow, ChatMessageView } from "@/renderer/chat/chat-message";
import { Composer } from "@/renderer/chat/composer";
import { useDiskState } from "@/renderer/lib/use-disk-state";
import { useAgentStore } from "@/renderer/stores/agent-store";
import { useVoiceStore } from "@/renderer/stores/voice-store";

// ---------------------------------------------------------------------------
// Layout
//
// 12-column grid. The conversation lives on the left; the right column holds
// placeholder panels that will eventually render live, user-generated
// artifacts. Layout changes persist to disk (~/.inteligir/ui-state.json).
// ---------------------------------------------------------------------------

const LAYOUT_KEY = "workspace-layout";

const DEFAULT_LAYOUT: LayoutItem[] = [
  { i: "conversation", x: 0, y: 0, w: 5, h: 12, minW: 3, minH: 5 },
  { i: "artifact-a", x: 5, y: 0, w: 7, h: 5, minW: 2, minH: 3 },
  { i: "artifact-b", x: 5, y: 5, w: 7, h: 7, minW: 2, minH: 3 },
];

function sameLayout(a: readonly LayoutItem[], b: readonly LayoutItem[]): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(b.map((it) => [it.i, it]));
  for (const it of a) {
    const other = byId.get(it.i);
    if (!other) return false;
    if (it.x !== other.x || it.y !== other.y || it.w !== other.w || it.h !== other.h) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Panel shell
// ---------------------------------------------------------------------------

function Panel({
  title,
  children,
  bodyClassName,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  bodyClassName?: string;
}) {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-border bg-card/40 shadow-lg backdrop-blur-md">
      <div className="panel-drag-handle flex shrink-0 cursor-move items-center justify-between border-b border-border/60 px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
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
// Placeholder artifact panel
// ---------------------------------------------------------------------------

function ArtifactPanel({ title }: { title: string }) {
  return (
    <Panel title={title}>
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <div className="size-10 rounded-xl border border-dashed border-border/70" />
        <p className="text-xs text-muted-foreground">Empty panel</p>
        <p className="max-w-[14rem] text-[10px] text-muted-foreground/60">
          Live artifacts you generate will take shape here.
        </p>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

export function PanelGrid() {
  const { width, containerRef } = useContainerWidth();
  const [stored, persist, loaded] = useDiskState<LayoutItem[]>(LAYOUT_KEY, DEFAULT_LAYOUT);

  // The grid is driven by local state; disk is a write-only sink so persistence
  // never feeds layout back into the grid mid-drag. We hydrate from disk once
  // it has loaded, and only render the grid afterwards so the saved layout
  // isn't briefly overwritten by the default.
  const [layout, setLayout] = useState<LayoutItem[] | null>(null);
  useEffect(() => {
    if (loaded && layout === null) setLayout(stored);
  }, [loaded, layout, stored]);

  const handleLayoutChange = useCallback(
    (next: Layout) => {
      const items = next as LayoutItem[];
      setLayout(items);
      if (!sameLayout(items, stored)) persist(items);
    },
    [persist, stored],
  );

  const ready = width > 0 && layout !== null;

  return (
    <div ref={containerRef} className="h-full w-full">
      {ready && (
        <GridLayout
          width={width}
          layout={layout ?? DEFAULT_LAYOUT}
          onLayoutChange={handleLayoutChange}
          gridConfig={{ cols: 12, rowHeight: 46, margin: [10, 10], containerPadding: [0, 0] }}
          dragConfig={{ enabled: true, bounded: false, handle: ".panel-drag-handle" }}
          resizeConfig={{ enabled: true, handles: ["se", "e", "s"] }}
        >
          <div key="conversation">
            <ConversationPanel />
          </div>
          <div key="artifact-a">
            <ArtifactPanel title="Panel" />
          </div>
          <div key="artifact-b">
            <ArtifactPanel title="Panel" />
          </div>
        </GridLayout>
      )}
    </div>
  );
}
