// CLAUDE.md § THE PANEL STARTS CLOSED, IS FLAT-TABBED, AND IS DRAGGED LIKE THE RAIL. The right
// panel's tabs: Info about one item (the open one, else the one card selected), and the built-in
// agent's conversations about the whole library.

import type { AgentViewContext } from "@repo/agent-panel/agent-send";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/components/tabs";
import { z } from "zod";

import { AgentPanel } from "../agent/agent-panel";
import { InfoTab } from "./info-tab";
import type { InfoActions } from "./info-tab";

const PANEL_TABS = ["info", "agent"] as const;
export type PanelTab = (typeof PANEL_TABS)[number];

const panelTabSchema = z.enum(PANEL_TABS);

export interface PanelProps {
  readonly itemId: string | null;
  readonly tab: PanelTab;
  readonly onTab: (tab: PanelTab) => void;
  readonly threadId: string | null;
  readonly onThread: (threadId: string | null) => void;
  readonly viewContext: () => AgentViewContext | undefined;
  readonly infoActions: InfoActions;
  // waits for the open note to store what was typed in it, which an undo does first
  readonly flushOpen: () => Promise<void>;
  // the agent's composer holds Tidy my library's request
  readonly tidying: boolean;
  readonly onTidyEnd: () => void;
  readonly passage: string | null;
  readonly onPassageTaken: () => void;
}

const NoItem = () => (
  <p className="m-0 p-3 text-body text-muted-foreground">Select an item to see it here.</p>
);

export const Panel = ({
  itemId,
  tab,
  onTab,
  threadId,
  onThread,
  viewContext,
  infoActions,
  flushOpen,
  tidying,
  onTidyEnd,
  passage,
  onPassageTaken,
}: PanelProps) => (
  <Tabs
    value={tab}
    onValueChange={(value) => {
      const next = panelTabSchema.safeParse(value);
      if (next.success) {
        onTab(next.data);
      }
    }}
    className="flex h-full min-h-0 flex-col"
  >
    <TabsList className="h-9 shrink-0 px-2">
      <TabsTrigger value="info">Info</TabsTrigger>
      <TabsTrigger value="agent">Agent</TabsTrigger>
    </TabsList>
    <TabsContent value="info" className="min-h-0 flex-1 overflow-y-auto">
      {itemId === null ? <NoItem /> : <InfoTab itemId={itemId} actions={infoActions} />}
    </TabsContent>
    <TabsContent value="agent" className="flex min-h-0 flex-1 flex-col">
      <AgentPanel
        threadId={threadId}
        onThread={onThread}
        viewContext={viewContext}
        flushOpen={flushOpen}
        tidying={tidying}
        onTidyEnd={onTidyEnd}
        passage={passage}
        onPassageTaken={onPassageTaken}
      />
    </TabsContent>
  </Tabs>
);
