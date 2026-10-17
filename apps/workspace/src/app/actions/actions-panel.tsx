import {
  TaskItem,
  TaskItemLabel,
  TaskItemRow,
  TaskList,
  TaskStatusLabel,
} from "@repo/ui/ai/task-rows";
import type { TaskStatus } from "@repo/ui/ai/task-rows";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/components/tabs";
import type { Thread } from "@repo/contract/local/threads/threads-schema";
import { Button } from "@repo/ui/components/button";
import type { ShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import type { UseInfiniteQueryResult } from "@tanstack/react-query";

import { useSignedOutHarness } from "../agents/agent-hooks";
import { AgentSignIn } from "../agents/agent-sign-in";
import { THREAD_ACTIVITY_LABELS, threadActivity } from "../thread-activity";
import type { ThreadActivity } from "../thread-activity";
import { useNoteThreads, useThreads } from "./thread-hooks";
import { ActionDetail } from "./action-detail";
import { InfoTab } from "./info-tab";
import type { InfoActions, PanelSubject } from "./info-tab";
import { AnnotationsTab } from "./annotations-tab";
import type { AnnotationFocus } from "./annotations-tab";
import { HistoryTab } from "./history-tab";
import { bindingFor } from "../global-shortcuts";

export type PanelTab = "info" | "annotations" | "actions" | "history";

const PANEL_TABS: readonly PanelTab[] = ["info", "annotations", "actions", "history"];
const PANEL_TAB_LABELS = {
  actions: "Actions",
  annotations: "Annotations",
  history: "History",
  info: "Info",
} satisfies Record<PanelTab, string>;

export interface ActionsPanelProps {
  docPath: string | null;
  // the keyboard the workspace listens with, so the empty states spell its chords
  modifier: ShortcutModifier;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  annotationFocus: AnnotationFocus | null;
  selectedThreadId: string | null;
  onSelectThread: (threadId: string | null) => void;
  onOpenDoc: (path: string) => void;
  // what Info is about, and the verbs it offers over it
  subject: PanelSubject;
  selectionCount: number;
  infoActions: InfoActions;
}

// ⌘K would open on the sign-in while the default agent is signed out, so the list offers it here.
const NoActionsYet = ({ modifier }: { modifier: ShortcutModifier }) =>
  useSignedOutHarness(null) === null ? (
    <p className="p-3 text-subtitle text-muted-foreground">
      No actions yet. Press {bindingFor("open-action-composer", modifier)} to ask the agent.
    </p>
  ) : (
    <div className="space-y-3 p-3">
      <p className="text-subtitle text-muted-foreground">
        No actions yet. Sign in to ask the agent to work on your library.
      </p>
      <AgentSignIn />
    </div>
  );

// picks the badge only; the wording stays THREAD_ACTIVITY_LABELS.
const ACTIVITY_TASK_STATUS = {
  archived: "done",
  done: "done",
  failed: "failed",
  running: "running",
} satisfies Record<ThreadActivity, TaskStatus>;

const ActionRow = ({
  thread,
  onSelect,
}: {
  thread: Thread;
  onSelect: (threadId: string) => void;
}) => {
  const activity = threadActivity(thread);
  return (
    <TaskItem>
      <TaskItemRow
        status={ACTIVITY_TASK_STATUS[activity]}
        onSelect={() => {
          onSelect(thread.id);
        }}
      >
        <TaskItemLabel>{thread.title ?? "Untitled action"}</TaskItemLabel>
        <TaskStatusLabel>{THREAD_ACTIVITY_LABELS[activity]}</TaskStatusLabel>
      </TaskItemRow>
    </TaskItem>
  );
};

const ShowMoreActions = ({
  pages,
  label,
}: {
  pages: Pick<UseInfiniteQueryResult, "fetchNextPage" | "hasNextPage" | "isFetchingNextPage">;
  label: string;
}) =>
  pages.hasNextPage ? (
    <div className="px-2 py-1">
      <Button
        variant="ghost"
        size="compact"
        aria-label={label}
        disabled={pages.isFetchingNextPage}
        onClick={() => {
          void pages.fetchNextPage();
        }}
      >
        Show more
      </Button>
    </div>
  ) : null;

export const ActionsPanel = ({
  docPath,
  tab,
  onTabChange,
  annotationFocus,
  selectedThreadId,
  onSelectThread,
  onOpenDoc,
  subject,
  selectionCount,
  infoActions,
  modifier,
}: ActionsPanelProps) => {
  const recentQuery = useThreads();
  const noteQuery = useNoteThreads(docPath);
  const recent = recentQuery.data ?? [];
  const noteActions = noteQuery.data ?? [];
  const otherActions = recent.filter((t) => docPath === null || t.originDocPath !== docPath);

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        const next = PANEL_TABS.find((name) => name === value);
        if (next !== undefined) {
          onTabChange(next);
        }
      }}
      className="h-full"
    >
      <div className="flex h-[var(--app-header-h)] shrink-0 items-center border-b border-line px-1.5">
        <TabsList aria-label="Panel tabs">
          {PANEL_TABS.map((name) => (
            <TabsTrigger key={name} value={name}>
              {PANEL_TAB_LABELS[name]}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <TabsContent value="annotations">
        <AnnotationsTab docPath={docPath} focus={annotationFocus} modifier={modifier} />
      </TabsContent>
      <TabsContent value="history">
        <HistoryTab key={docPath} docPath={docPath} />
      </TabsContent>
      <TabsContent value="info">
        <InfoTab
          subject={subject}
          selectionCount={selectionCount}
          actions={infoActions}
          onOpenDoc={onOpenDoc}
        />
      </TabsContent>
      <TabsContent value="actions">
        {selectedThreadId === null ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {noteActions.length > 0 ? (
              <>
                <p className="px-2 pt-1 pb-0.5 text-caption font-medium text-muted-foreground uppercase">
                  This item
                </p>
                <TaskList variant="list">
                  {noteActions.map((thread) => (
                    <ActionRow key={thread.id} thread={thread} onSelect={onSelectThread} />
                  ))}
                </TaskList>
                <ShowMoreActions pages={noteQuery} label="Show more for this item" />
              </>
            ) : null}
            {otherActions.length > 0 || recentQuery.hasNextPage ? (
              <>
                <p className="px-2 pt-2 pb-0.5 text-caption font-medium text-muted-foreground uppercase">
                  Recent
                </p>
                <TaskList variant="list">
                  {otherActions.map((thread) => (
                    <ActionRow key={thread.id} thread={thread} onSelect={onSelectThread} />
                  ))}
                </TaskList>
                <ShowMoreActions pages={recentQuery} label="Show more recent actions" />
              </>
            ) : null}
            {recent.length === 0 && noteActions.length === 0 ? (
              <NoActionsYet modifier={modifier} />
            ) : null}
          </div>
        ) : (
          <ActionDetail
            key={selectedThreadId}
            threadId={selectedThreadId}
            onBack={() => {
              onSelectThread(null);
            }}
            onOpenDoc={onOpenDoc}
            onShowHistory={(path) => {
              onOpenDoc(path);
              onTabChange("history");
            }}
          />
        )}
      </TabsContent>
    </Tabs>
  );
};
