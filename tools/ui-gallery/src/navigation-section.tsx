// Navigation: moving between places, and the frame that holds them.

import { Sidebar } from "@repo/ui/components/sidebar";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupActions,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
} from "@repo/ui/components/sidebar-core";
import {
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@repo/ui/components/sidebar-menu";
import { Button } from "@repo/ui/components/button";
import { ChevronDownIcon, EllipsisIcon, PlusIcon, SearchIcon, SettingsIcon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/components/tabs";

import { useState } from "react";
import { Demo, GallerySection } from "./gallery-chrome";

const SIDEBAR_FOLDERS = ["Reading list", "Work", "Travel"];

const SidebarDemo = () => {
  const [open, setOpen] = useState(true);
  return (
    <div className="h-[260px] w-full overflow-hidden rounded-lg border border-line">
      <SidebarProvider className="h-full min-h-0" width="12rem" style={{ minHeight: "100%" }}>
        <Sidebar variant="floating" label="Sidebar">
          <SidebarHeader>
            <div className="flex items-center gap-1 pr-1.5">
              <span className="min-w-0 flex-1 truncate px-2 text-[13px] font-semibold">
                Library
              </span>
              <Button variant="ghost" size="icon-compact" className="size-6" aria-label="Search">
                <SearchIcon />
              </Button>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel
                aria-expanded={open}
                onClick={() => {
                  setOpen(!open);
                }}
              >
                Folders
                <ChevronDownIcon
                  size={12}
                  strokeWidth={1.5}
                  className={open ? "shrink-0" : "shrink-0 -rotate-90"}
                />
              </SidebarGroupLabel>
              <SidebarGroupActions>
                <SidebarGroupAction aria-label="New folder">
                  <PlusIcon />
                </SidebarGroupAction>
              </SidebarGroupActions>
              {open ? (
                <SidebarMenu aria-label="Folders">
                  {SIDEBAR_FOLDERS.map((folder, index) => (
                    <SidebarMenuItem key={folder}>
                      <SidebarMenuButton isActive={index === 0} className="pr-8">
                        {folder}
                      </SidebarMenuButton>
                      <SidebarMenuAction showOnHover aria-label={`Actions for ${folder}`}>
                        <EllipsisIcon />
                      </SidebarMenuAction>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              ) : null}
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter>
            <div className="flex items-center gap-1 pr-1.5">
              <span className="min-w-0 flex-1 truncate px-2 text-xs text-muted-foreground">
                Up to date
              </span>
              <Button variant="ghost" size="icon-compact" className="size-6" aria-label="Settings">
                <SettingsIcon />
              </Button>
            </div>
          </SidebarFooter>
        </Sidebar>
        <SidebarInset className="bg-surface">
          <div className="flex items-center gap-2 border-b border-line p-2">
            <span className="text-sm text-muted-foreground">Reading list</span>
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
      purpose="A panel's tabs: a flat row of labels under one sliding underline, Base UI's Tabs."
      stack
    >
      <div className="w-full max-w-sm rounded-lg border border-line">
        <Tabs defaultValue="info">
          <div className="flex h-9 items-center border-b border-line px-1.5">
            <TabsList aria-label="Panel tabs">
              <TabsTrigger value="info">Info</TabsTrigger>
              <TabsTrigger value="highlights">Highlights</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="info">
            <p className="p-3 text-sm text-muted-foreground">Saved from stephango.com.</p>
          </TabsContent>
          <TabsContent value="highlights">
            <p className="p-3 text-sm text-muted-foreground">One highlight with a note.</p>
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
