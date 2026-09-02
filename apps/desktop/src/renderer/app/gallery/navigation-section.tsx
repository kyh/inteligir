// Navigation: moving between places, and the frame that holds them.

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@repo/ui/components/sidebar";
import { TabsSubtle, TabsSubtleItem } from "@repo/ui/components/tabs-subtle";
import { FileTextIcon, MessageSquareTextIcon } from "lucide-react";
import { useState } from "react";

import { Demo, GallerySection } from "./gallery-chrome";

const SIDEBAR_NOTES = ["Release checklist", "Weekly review", "Kitchen Sink"];

export function NavigationSection() {
  const [tab, setTab] = useState(0);

  return (
    <GallerySection id="navigation" title="Navigation">
      <Demo
        name="TabsSubtle · TabsSubtleItem"
        purpose="Switches which panel a fixed region shows. The selection is view state, never a route."
        stack
      >
        <div className="w-full max-w-sm rounded-lg border border-line">
          <TabsSubtle selectedIndex={tab} onSelect={setTab}>
            <TabsSubtleItem index={0} icon={FileTextIcon} label="Actions" />
            <TabsSubtleItem index={1} icon={MessageSquareTextIcon} label="Comments" />
          </TabsSubtle>
          {tab === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">Two actions on this note.</p>
          ) : (
            <p className="p-3 text-sm text-muted-foreground">One unresolved comment.</p>
          )}
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
              <SidebarContent>
                <SidebarGroup>
                  <SidebarGroupLabel>Notes</SidebarGroupLabel>
                  <SidebarMenu>
                    {SIDEBAR_NOTES.map((note, index) => (
                      <SidebarMenuItem key={note}>
                        <SidebarMenuButton isActive={index === 0}>{note}</SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroup>
              </SidebarContent>
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
