import { useCallback, useEffect, useMemo, useState } from "react";
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

import { ArtifactViewer } from "@/renderer/chat/artifact-viewer";
import { ChatActivityRow, ChatMessageView } from "@/renderer/chat/chat-message";
import { Composer } from "@/renderer/chat/composer";
import { useDiskState } from "@/renderer/lib/use-disk-state";
import { useAgentStore } from "@/renderer/stores/agent-store";
import { initArtifacts, useArtifactsStore } from "@/renderer/stores/artifacts-store";
import { useVoiceStore } from "@/renderer/stores/voice-store";

// ---------------------------------------------------------------------------
// Layout
//
// 12-column grid. The conversation lives on the left; every artifact the agent
// has created is slotted in as its own draggable / resizable panel. Geometry
// persists to disk (~/.inteligir/ui-state.json) keyed by item id, so an
// artifact keeps its size/position across reloads. New artifacts append to the
// right column; deleted ones drop out.
// ---------------------------------------------------------------------------

const LAYOUT_KEY = "workspace-layout";
const ARTIFACT_PREFIX = "art:";

const CONVERSATION_ITEM: LayoutItem = {
  i: "conversation",
  x: 0,
  y: 0,
  w: 5,
  h: 12,
  minW: 3,
  minH: 5,
};
const DEFAULT_LAYOUT: LayoutItem[] = [CONVERSATION_ITEM];

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

/**
 * Reconcile a saved layout against the live artifact set: keep the
 * conversation item, preserve geometry for artifacts that already have a slot,
 * append a default slot for new artifacts, and drop slots for artifacts that
 * no longer exist. Idempotent — reconcile(reconcile(x)) === reconcile(x).
 */
function reconcileLayout(
  base: readonly LayoutItem[],
  artifactIds: readonly string[],
): LayoutItem[] {
  const byId = new Map(base.map((it) => [it.i, it]));
  const out: LayoutItem[] = [byId.get("conversation") ?? CONVERSATION_ITEM];
  let nextY = base.reduce((max, it) => Math.max(max, it.y + it.h), 0);
  for (const id of artifactIds) {
    const key = ARTIFACT_PREFIX + id;
    const existing = byId.get(key);
    if (existing) {
      out.push(existing);
    } else {
      out.push({ i: key, x: 5, y: nextY, w: 7, h: 6, minW: 2, minH: 3 });
      nextY += 6;
    }
  }
  return out;
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
        <span className="truncate text-xs font-medium text-muted-foreground">{title}</span>
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
  const [stored, persist, loaded] = useDiskState<LayoutItem[]>(LAYOUT_KEY, DEFAULT_LAYOUT);

  useEffect(() => {
    initArtifacts();
  }, []);
  const artifacts = useArtifactsStore((s) => s.artifacts);
  const artifactIds = useMemo(() => artifacts.map((a) => a.id), [artifacts]);

  // Local working layout drives the grid; disk is a write sink so persistence
  // doesn't feed back mid-drag. Hydrate once from disk, then derive the
  // rendered layout by reconciling against the live artifact set so the grid
  // and its children always agree on the item set.
  const [layout, setLayout] = useState<LayoutItem[] | null>(null);
  useEffect(() => {
    if (loaded && layout === null) setLayout(stored);
  }, [loaded, layout, stored]);

  const renderLayout = useMemo(
    () => (layout ? reconcileLayout(layout, artifactIds) : null),
    [layout, artifactIds],
  );

  // Persist when reconciliation diverges from disk (a new or removed artifact).
  useEffect(() => {
    if (renderLayout && !sameLayout(renderLayout, stored)) persist(renderLayout);
  }, [renderLayout, stored, persist]);

  const handleLayoutChange = useCallback(
    (next: Layout) => {
      const items = next as LayoutItem[];
      setLayout(items);
      if (!sameLayout(items, stored)) persist(items);
    },
    [persist, stored],
  );

  const ready = width > 0 && renderLayout !== null;

  return (
    <div ref={containerRef} className="h-full w-full">
      {ready && (
        <GridLayout
          width={width}
          layout={renderLayout ?? DEFAULT_LAYOUT}
          onLayoutChange={handleLayoutChange}
          gridConfig={{ cols: 12, rowHeight: 46, margin: [10, 10], containerPadding: [0, 0] }}
          dragConfig={{ enabled: true, bounded: false, handle: ".panel-drag-handle" }}
          resizeConfig={{ enabled: true, handles: ["se", "e", "s"] }}
        >
          <div key="conversation">
            <ConversationPanel />
          </div>
          {artifacts.map((artifact) => (
            <div key={ARTIFACT_PREFIX + artifact.id}>
              <Panel title={artifact.title}>
                <ArtifactViewer id={artifact.id} />
              </Panel>
            </div>
          ))}
        </GridLayout>
      )}
    </div>
  );
}
