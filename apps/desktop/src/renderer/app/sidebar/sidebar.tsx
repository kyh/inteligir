import { Button } from "@repo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupActions,
  SidebarGroupLabel,
  SidebarHeader,
} from "@repo/ui/components/sidebar-core";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@repo/ui/components/sidebar-menu";
import { Spinner } from "@repo/ui/components/spinner";
import { Tooltip } from "@repo/ui/components/tooltip";
import { useTheme } from "@repo/ui/lib/theme";
import { cn } from "@repo/ui/lib/cn";
import type { CloudStatusResponse } from "@repo/contract/local/cloud/cloud-schema";
import {
  ChevronsUpDownIcon,
  InfoIcon,
  LogInIcon,
  LogOutIcon,
  MoonIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SettingsIcon,
  SunIcon,
} from "lucide-react";
import { useState } from "react";
import { useAgentWorking, useThreads } from "../actions/thread-hooks";
import { useCloudSession } from "../cloud-session";
import type { CloudSession } from "../cloud-session";
import { AccountForm } from "../account-form";
import type { SettingsSection } from "../settings/settings-page";
import { hasInsetTitleBar } from "../title-bar";

// the rows the rail lists; the palette's Actions page and the panel find the rest
const RECENT_LIMIT = 8;

// the tooltip's label with its chord beside it, on the tooltip's own height
const tipWithShortcut = (label: string, shortcut: string | null) =>
  shortcut === null ? (
    label
  ) : (
    <span className="flex items-center gap-2">
      <span>{label}</span>
      <kbd className="-my-1 flex h-4 min-w-4 items-center justify-center rounded border border-background/30 px-1 font-sans text-caption text-background/80">
        {shortcut}
      </kbd>
    </span>
  );

// Every sentence here is the user's: the sync's own error text is Settings › Advanced's to show.
const syncLabel = (status: CloudStatusResponse): string => {
  switch (status.state) {
    case "signed-out": {
      return "Only on this Mac";
    }
    case "unauthorized": {
      return "Signed out of sync";
    }
    case "signed-in": {
      if (status.lastError !== null) {
        return "Sync paused";
      }
      return status.lastSyncedAt === null ? "Not synced yet" : "Synced";
    }
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
};

const syncDotClass = (status: CloudStatusResponse): string => {
  switch (status.state) {
    case "signed-out": {
      return "bg-muted-foreground/40";
    }
    case "unauthorized": {
      return "bg-destructive";
    }
    case "signed-in": {
      if (status.lastError !== null) {
        return "bg-destructive";
      }
      return status.lastSyncedAt === null ? "bg-amber-500" : "bg-success";
    }
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
};

// the line under the row's menu; null where silence is the answer
const syncNote = (status: CloudStatusResponse): string | null => {
  switch (status.state) {
    case "signed-out": {
      return "Sign in to carry your threads to your other devices.";
    }
    case "unauthorized": {
      return "This Mac was signed out of your account. Sign in again to resume syncing.";
    }
    case "signed-in": {
      return status.lastError === null
        ? null
        : "Sync can't continue on its own. Details in Settings › Advanced.";
    }
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
};

// The account the rail's sync row offers, over the same flow Settings › Account runs.
const AccountDialog = ({
  cloudUrl,
  session,
  open,
  onOpenChange,
}: {
  cloudUrl: string;
  session: CloudSession;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-sm">
      <DialogHeader>
        <DialogTitle>Sign in or create an account</DialogTitle>
        <DialogDescription>Signed out, this app makes no cloud requests at all.</DialogDescription>
      </DialogHeader>
      <AccountForm cloudUrl={cloudUrl} session={session} />
    </DialogContent>
  </Dialog>
);

// The rail's ambient row: the threads' sync state as the row, and behind it the verbs that change
// it — a sync now, and the account this device does or does not have.
export const SyncRow = ({ onOpenSyncDetails }: { onOpenSyncDetails: () => void }) => {
  const agentWorking = useAgentWorking();
  const session = useCloudSession();
  const [signInOpen, setSignInOpen] = useState(false);
  const cloud = session.status;
  const note = cloud === undefined ? null : syncNote(cloud);
  // a sign-in that landed closes its dialog, or a later sign-out would open it again
  if (cloud?.state === "signed-in" && signInOpen) {
    setSignInOpen(false);
  }
  const handleSignOut = session.signOut;
  const handleSyncNow = session.syncThreads;
  return (
    <>
      <SidebarMenu aria-label="Sync" className="min-w-0 flex-1">
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <SidebarMenuButton aria-label="Sync and account">
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      cloud === undefined ? "bg-muted-foreground/40" : syncDotClass(cloud),
                    )}
                  />
                  {cloud === undefined ? "…" : syncLabel(cloud)}
                  {agentWorking ? (
                    <Spinner className="ml-1 size-3 shrink-0 text-muted-foreground" />
                  ) : null}
                  <span className="ml-auto -mr-0.5 flex size-6 shrink-0 items-center justify-center">
                    <ChevronsUpDownIcon
                      size={16}
                      strokeWidth={1.5}
                      className="text-muted-foreground"
                    />
                  </span>
                </SidebarMenuButton>
              }
            />
            <DropdownMenuContent side="top" align="start" sideOffset={6}>
              {note === null ? null : (
                <DropdownMenuLabel className="max-w-64 whitespace-normal">{note}</DropdownMenuLabel>
              )}
              <DropdownMenuItem
                disabled={cloud?.state !== "signed-in" || session.pending}
                onClick={handleSyncNow}
              >
                <RefreshCwIcon />
                Sync now
              </DropdownMenuItem>
              {cloud?.state === "signed-in" && cloud.lastError !== null ? (
                <DropdownMenuItem onClick={onOpenSyncDetails}>
                  <InfoIcon />
                  Sync details…
                </DropdownMenuItem>
              ) : null}
              {cloud === undefined || cloud.state === "signed-in" ? null : (
                <DropdownMenuItem
                  onClick={() => {
                    setSignInOpen(true);
                  }}
                >
                  <LogInIcon />
                  Sign in…
                </DropdownMenuItem>
              )}
              {cloud?.state === "signed-in" ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="max-w-64 truncate">
                    {cloud.accountEmail ?? new URL(cloud.cloudUrl).host}
                  </DropdownMenuLabel>
                  <DropdownMenuItem disabled={session.pending} onClick={handleSignOut}>
                    <LogOutIcon />
                    Sign out
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
      {cloud === undefined ? null : (
        <AccountDialog
          cloudUrl={cloud.cloudUrl}
          session={session}
          open={signInOpen}
          onOpenChange={setSignInOpen}
        />
      )}
    </>
  );
};

const ThemeButton = () => {
  const { resolved, setTheme } = useTheme();
  const next = resolved === "dark" ? "light" : "dark";
  return (
    <Tooltip content={next === "dark" ? "Dark theme" : "Light theme"} side="top">
      <Button
        variant="ghost"
        size="icon-compact"
        className="size-6 shrink-0"
        aria-label={next === "dark" ? "Switch to dark theme" : "Switch to light theme"}
        onClick={() => {
          setTheme(next);
        }}
      >
        {resolved === "dark" ? <SunIcon /> : <MoonIcon />}
      </Button>
    </Tooltip>
  );
};

// the recent actions, newest first; a pick opens it in the panel
const RecentActions = ({
  selectedThreadId,
  onOpenThread,
}: {
  selectedThreadId: string | null;
  onOpenThread: (threadId: string) => void;
}) => {
  const threads = (useThreads().data ?? []).slice(0, RECENT_LIMIT);
  if (threads.length === 0) {
    return <p className="px-2 py-1 text-body text-muted-foreground">No actions yet.</p>;
  }
  return (
    <SidebarMenu aria-label="Recent actions">
      {threads.map((thread) => (
        <SidebarMenuItem key={thread.id}>
          <SidebarMenuButton
            isActive={thread.id === selectedThreadId}
            onClick={() => {
              onOpenThread(thread.id);
            }}
          >
            <span className="min-w-0 truncate">{thread.title ?? "Untitled action"}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
};

export interface SidebarRailContentProps {
  selectedThreadId: string | null;
  onOpenThread: (threadId: string) => void;
  onAskAgent: () => void;
  // the header's Search opens the one palette; the chord is spelled by the workspace's table
  onOpenSearch: () => void;
  searchShortcut: string | null;
  onOpenSettings: (section?: SettingsSection) => void;
}

export const SidebarRailContent = ({
  selectedThreadId,
  onOpenThread,
  onAskAgent,
  onOpenSearch,
  searchShortcut,
  onOpenSettings,
}: SidebarRailContentProps) => {
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [insetTitleBar] = useState(hasInsetTitleBar);

  // Fluid's sidebar anatomy: the app's name and Search share the header line; one group of the
  // recent actions, with Ask the agent as the group's action; the sync row, Settings and the
  // theme in the footer.
  return (
    <>
      <SidebarHeader>
        {insetTitleBar ? (
          // the shell drags the window from a mousedown on this element itself
          <div aria-hidden="true" className="h-5 shrink-0" data-tauri-drag-region />
        ) : null}
        <div className="flex items-center gap-1 pr-1.5">
          <span className="min-w-0 flex-1 truncate pl-2 text-subtitle font-semibold text-foreground">
            Inteligir
          </span>
          <Tooltip content={tipWithShortcut("Search", searchShortcut)} side="bottom">
            <Button
              variant="ghost"
              size="icon-compact"
              className="size-6 shrink-0"
              aria-label="Search"
              onClick={onOpenSearch}
            >
              <SearchIcon />
            </Button>
          </Tooltip>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Actions</SidebarGroupLabel>
          <SidebarGroupActions>
            <Tooltip content="New action" side="top">
              <SidebarGroupAction aria-label="New action" onClick={onAskAgent}>
                <PlusIcon />
              </SidebarGroupAction>
            </Tooltip>
          </SidebarGroupActions>
          <RecentActions selectedThreadId={selectedThreadId} onOpenThread={onOpenThread} />
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center gap-1 pr-1.5">
          <SyncRow
            onOpenSyncDetails={() => {
              onOpenSettings("advanced");
            }}
          />
          <Tooltip content="Settings" side="top">
            <Button
              variant="ghost"
              size="icon-compact"
              className="size-6 shrink-0"
              aria-label="Settings"
              onClick={() => {
                onOpenSettings();
              }}
            >
              <SettingsIcon />
            </Button>
          </Tooltip>
          <ThemeButton />
        </div>
      </SidebarFooter>
    </>
  );
};
