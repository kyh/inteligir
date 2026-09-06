// Navigation: moving between places, and the frame that holds them.

import {
  Sidebar,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarProvider,
} from "@repo/ui/components/sidebar";
import { cn } from "cn";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/components/tabs";

import { Demo, GallerySection } from "./gallery-chrome";

const SIDEBAR_NOTES = ["Release checklist", "Weekly review", "Kitchen Sink"];

export function NavigationSection() {
  return (
    <GallerySection id="navigation" title="Navigation">
      <Demo
        name="Tabs · TabsList · TabsTrigger · TabsContent"
        purpose="A panel's tabs: a flat row of labels under one sliding underline, Base UI's Tabs. The pill switch above is for a fixed region's views."
        stack
      >
        <div className="w-full max-w-sm rounded-lg border border-line">
          <Tabs defaultValue="actions">
            <div className="flex h-9 items-center border-b border-line px-1.5">
              <TabsList aria-label="Panel tabs">
                <TabsTrigger value="actions">Actions</TabsTrigger>
                <TabsTrigger value="comments">Comments</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="actions">
              <p className="p-3 text-sm text-muted-foreground">Two actions on this note.</p>
            </TabsContent>
            <TabsContent value="comments">
              <p className="p-3 text-sm text-muted-foreground">One unresolved comment.</p>
            </TabsContent>
            <TabsContent value="history">
              <p className="p-3 text-sm text-muted-foreground">Four revisions.</p>
            </TabsContent>
          </Tabs>
        </div>
      </Demo>

      <Demo
        name="Sidebar"
        purpose="The app frame's rail: collapsible, resizable, and the thing SidebarInset sits beside."
        note="Bounded to 260px here. In the product it owns the viewport, and its width persists."
        stack
      >
        <div className="h-[260px] w-full overflow-hidden rounded-lg border border-line">
          <SidebarProvider className="h-full min-h-0" width="12rem" style={{ minHeight: "100%" }}>
            <Sidebar variant="floating">
              <SidebarHeader>
                <SidebarInput placeholder="Search…" readOnly />
              </SidebarHeader>
              <div className="flex min-h-0 flex-1 flex-col py-1">
                <p className="px-3 pt-1 pb-0.5 text-[11px] font-medium text-muted-foreground uppercase">
                  Notes
                </p>
                {SIDEBAR_NOTES.map((note, index) => (
                  <button
                    key={note}
                    type="button"
                    className={cn(
                      "flex h-chrome-row w-full items-center px-3 text-sm hover:bg-muted/60",
                      index === 0 ? "bg-muted text-foreground" : "text-foreground/80",
                    )}
                  >
                    {note}
                  </button>
                ))}
              </div>
            </Sidebar>
            <SidebarInset className="bg-surface">
              <div className="flex items-center gap-2 border-b border-line p-2">
                <span className="text-sm text-muted-foreground">Release checklist</span>
              </div>
              <p className="p-3 text-sm text-muted-foreground">The content the rail sits beside.</p>
            </SidebarInset>
          </SidebarProvider>
        </div>
      </Demo>
    </GallerySection>
  );
}
