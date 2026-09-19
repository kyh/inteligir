// Navigation: moving between places, and the frame that holds them.

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupActions,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@repo/ui/components/sidebar";
import { Button } from "@repo/ui/components/button";
import { EllipsisIcon, PlusIcon, SearchIcon, SettingsIcon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/components/tabs";

import { useState } from "react";
import { Demo, GallerySection } from "./gallery-chrome";

const SIDEBAR_NOTES = ["Release checklist", "Weekly review", "Kitchen Sink"];

// the group's label is its switch here, as it is in the product
const SidebarDemo = () => {
  const [view, setView] = useState<"Recent" | "Files">("Recent");
  return (
    <div className="h-[260px] w-full overflow-hidden rounded-lg border border-line">
      <SidebarProvider className="h-full min-h-0" width="12rem" style={{ minHeight: "100%" }}>
        <Sidebar variant="floating">
          <SidebarHeader>
            <div className="flex items-center gap-1 pr-1.5">
              <span className="min-w-0 flex-1 truncate px-2 text-[13px] font-semibold">Vault</span>
              <Button variant="ghost" size="icon-compact" className="size-6" aria-label="Search">
                <SearchIcon />
              </Button>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel
                onClick={() => {
                  setView((current) => (current === "Recent" ? "Files" : "Recent"));
                }}
              >
                {view}
              </SidebarGroupLabel>
              <SidebarGroupActions>
                <SidebarGroupAction aria-label="New note">
                  <PlusIcon />
                </SidebarGroupAction>
              </SidebarGroupActions>
              <SidebarMenu aria-label="Notes">
                {SIDEBAR_NOTES.map((note, index) => (
                  <SidebarMenuItem key={note}>
                    <SidebarMenuButton isActive={index === 0} className="pr-8">
                      {note}
                    </SidebarMenuButton>
                    <SidebarMenuAction showOnHover aria-label={`Actions for ${note}`}>
                      <EllipsisIcon />
                    </SidebarMenuAction>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter>
            <div className="flex items-center gap-1 pr-1.5">
              <span className="min-w-0 flex-1 truncate px-2 text-xs text-muted-foreground">
                Local only
              </span>
              <Button variant="ghost" size="icon-compact" className="size-6" aria-label="Settings">
                <SettingsIcon />
              </Button>
            </div>
          </SidebarFooter>
        </Sidebar>
        <SidebarInset className="bg-surface">
          <div className="flex items-center gap-2 border-b border-line p-2">
            <span className="text-sm text-muted-foreground">Release checklist</span>
          </div>
          <p className="p-3 text-sm text-muted-foreground">The content the rail sits beside.</p>
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
};

export const NavigationSection = () => (
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
      <SidebarDemo />
    </Demo>
  </GallerySection>
);
