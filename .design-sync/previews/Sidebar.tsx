import {
  Sidebar,
  SidebarProvider,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuAction,
  SidebarMenuSub,
  SidebarTrigger,
} from "@repo/ui";
import {
  NotebookPen,
  Inbox,
  Files,
  Star,
  FolderOpen,
  Folder,
  Calendar,
  Settings,
  MoreHorizontal,
  ListChecks,
  BarChart3,
} from "lucide-react";

// The real workspace mounts <Sidebar collapsible="icon"> which is position:fixed
// + h-svh (it owns the whole app-window edge). For a bounded preview card we use
// collapsible="none": same chrome + tokens, but h-full so it stays inside the box.

export function VaultNavigator() {
  return (
    <div style={{ height: 420, display: "flex", overflow: "hidden", borderRadius: 12 }}>
      <SidebarProvider>
        <Sidebar collapsible="none" className="border-r border-sidebar-border">
          <SidebarHeader>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                padding: "2px 4px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 7,
                    display: "grid",
                    placeItems: "center",
                    background: "var(--foreground)",
                    color: "var(--background)",
                  }}
                >
                  <NotebookPen style={{ width: 14, height: 14 }} />
                </div>
                <span style={{ fontWeight: 600, fontSize: 14, letterSpacing: "-0.01em" }}>
                  inteligir
                </span>
              </div>
              <SidebarTrigger />
            </div>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Vault</SidebarGroupLabel>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton>
                    <Inbox />
                    <span>Inbox</span>
                    <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.6 }}>3</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton>
                    <Files />
                    <span>All notes</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton>
                    <Star />
                    <span>Starred</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>Projects</SidebarGroupLabel>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive>
                    <FolderOpen />
                    <span>Q3 launch</span>
                  </SidebarMenuButton>
                  <SidebarMenuAction showOnHover={false} aria-label="Project actions">
                    <MoreHorizontal />
                  </SidebarMenuAction>
                  <SidebarMenuSub>
                    <SidebarMenuItem>
                      <SidebarMenuButton size="sm">
                        <ListChecks />
                        <span>Launch checklist</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton size="sm">
                        <BarChart3 />
                        <span>Metrics review</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenuSub>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton>
                    <Folder />
                    <span>Website redesign</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton>
                    <Folder />
                    <span>Research</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>Daily notes</SidebarGroupLabel>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton>
                    <Calendar />
                    <span>2026-07-04</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton>
                    <Calendar />
                    <span>2026-07-03</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton>
                  <Settings />
                  <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>

        <div
          style={{
            flex: 1,
            padding: "20px 24px",
            background: "var(--background)",
            color: "var(--foreground)",
          }}
        >
          <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 6 }}>Q3 launch</div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em" }}>
            Launch checklist
          </div>
          <div style={{ marginTop: 14, fontSize: 13, lineHeight: 1.7, opacity: 0.75 }}>
            The open note renders in the single-document editor. The sidebar to the left is the
            vault navigator — folders, daily notes, and starred pages.
          </div>
        </div>
      </SidebarProvider>
    </div>
  );
}

export function MenuStates() {
  return (
    <div style={{ height: 320, display: "flex", overflow: "hidden", borderRadius: 12 }}>
      <SidebarProvider>
        <Sidebar collapsible="none" className="border-r border-sidebar-border">
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Menu states</SidebarGroupLabel>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton>
                    <Files />
                    <span>Default item</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive>
                    <FolderOpen />
                    <span>Active item</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton>
                    <Star />
                    <span>With action</span>
                  </SidebarMenuButton>
                  <SidebarMenuAction showOnHover={false} aria-label="More">
                    <MoreHorizontal />
                  </SidebarMenuAction>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton disabled>
                    <Inbox />
                    <span>Disabled item</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton>
                    <Folder />
                    <span>Nested folder</span>
                  </SidebarMenuButton>
                  <SidebarMenuSub>
                    <SidebarMenuItem>
                      <SidebarMenuButton size="sm">
                        <ListChecks />
                        <span>Sub item, small</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton size="sm" isActive>
                        <BarChart3 />
                        <span>Sub item, active</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenuSub>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>
    </div>
  );
}
