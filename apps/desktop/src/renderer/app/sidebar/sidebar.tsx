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
import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import {
  ChevronDownIcon,
  ChevronsUpDownIcon,
  FolderOpenIcon,
  InfoIcon,
  LogInIcon,
  LogOutIcon,
  MoonIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SettingsIcon,
  SunIcon,
  VaultIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "@repo/ui/components/sonner";
import { useAgentWorking } from "../actions/thread-hooks";
import { useCloudSession } from "../cloud-session";
import type { CloudSession } from "../cloud-session";
import {
  openRecentVault,
  pickVault,
  RecentVaultLabel,
  useDesktopVaults,
  useVaultSwitch,
} from "../desktop-vaults";
import { PREFS, RAIL_VIEWS, usePref } from "../prefs";
import type { RailView } from "../prefs";
import { SignInForm } from "../sign-in-form";
import type { SettingsSection } from "../settings/settings-page";
import { hasInsetTitleBar } from "../title-bar";
import {
  canSyncNow,
  syncNeedsAttention,
  syncStateDotClass,
  syncStateLabel,
  syncStateNote,
  usePinnedPaths,
  useVaultStatus,
  useVaultTree,
  visibleEntries,
} from "../vault-hooks";
import { DeletedNotes } from "./deleted-notes";
import { FileTree } from "./file-tree";
import type { TreeLoadState, TreeOps } from "./file-tree";
import { NotesList } from "./notes-list";
import { TaggedNotes } from "./tagged-notes";
import { useTreeState } from "./tree-state";
import type { TreeReveal } from "./tree-state";

const EMPTY_ENTRIES: readonly VaultEntry[] = [];

const treeLoadState = (query: ReturnType<typeof useVaultTree>): TreeLoadState => {
  if (query.isError) {
    return "failed";
  }
  return query.data === undefined ? "loading" : "loaded";
};

// the rows the Recent view shows; the palette lists every note
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

// the vault's mark: its initial on a 20px tile, centred on the rows' leading icon axis
const VaultTile = ({ name }: { name: string }) => (
  <span
    aria-hidden="true"
    className="pointer-events-none absolute top-1/2 left-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-md bg-foreground text-caption font-semibold text-background"
  >
    {name.slice(0, 1).toLocaleUpperCase()}
  </span>
);

// The vault is the server's: switching it restarts the child and replaces this window, and the
// folder is picked in main, so this is a menu over what main remembers. A browser tab has no
// bridge and did not start the server, so it gets the name alone.
const VaultRow = ({ vaultName }: { vaultName: string }) => {
  const vaults = useDesktopVaults();
  const { busy, run } = useVaultSwitch((message) => {
    toast.error(message);
  });
  const label = (
    <span className="min-w-0 truncate text-subtitle font-semibold text-foreground">
      {vaultName}
    </span>
  );
  if (vaults.kind !== "state") {
    return (
      <div className="relative flex h-7 items-center pr-2 pl-8">
        <VaultTile name={vaultName} />
        {label}
      </div>
    );
  }
  const { state } = vaults;
  return (
    <SidebarMenu aria-label="Vault" className="@container">
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={busy !== null}
            render={
              <SidebarMenuButton aria-label="Switch vault" className="pl-8 disabled:opacity-50">
                <VaultTile name={vaultName} />
                {label}
                <span className="ml-auto inline-flex @max-[7rem]:hidden">
                  <ChevronDownIcon size={16} strokeWidth={1.5} className="text-muted-foreground" />
                </span>
              </SidebarMenuButton>
            }
          />
          <DropdownMenuContent align="start" sideOffset={4}>
            {state.recent.map((vault) => (
              <DropdownMenuItem
                key={vault.path}
                className="h-auto py-1.5"
                onClick={() => {
                  run("opening", async () => await openRecentVault(vault.path));
                }}
              >
                <VaultIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <RecentVaultLabel vault={vault} />
              </DropdownMenuItem>
            ))}
            {state.recent.length > 0 ? <DropdownMenuSeparator /> : null}
            {state.blocked === null ? (
              <DropdownMenuItem
                onClick={() => {
                  run("picking", pickVault);
                }}
              >
                <FolderOpenIcon className="size-3.5 shrink-0 text-muted-foreground" />
                Open another vault…
              </DropdownMenuItem>
            ) : (
              <DropdownMenuLabel className="max-w-64 whitespace-normal">
                {state.blocked}
              </DropdownMenuLabel>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
};

const RAIL_VIEW_LABELS: Record<RailView, string> = {
  deleted: "Deleted",
  files: "Files",
  recent: "Recent",
};

// The sign-in the rail's sync row offers, over the same flow Settings › Devices runs.
const SignInDialog = ({
  cloudUrl,
  session,
  open,
  onOpenChange,
}: {
  cloudUrl: string;
  session: CloudSession;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const handleSignIn = session.signIn;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Sign in</DialogTitle>
          <DialogDescription>
            Your threads and your vault sync through your account. Signed out, this app makes no
            cloud requests at all.
          </DialogDescription>
        </DialogHeader>
        <SignInForm
          cloudUrl={cloudUrl}
          onSignIn={handleSignIn}
          pending={session.pending}
          refusal={session.refusal}
        />
      </DialogContent>
    </Dialog>
  );
};

// The rail's ambient row: the vault's sync state as the row, and behind it the verbs that change
// it — a sync now, and the account this device does or does not have. Actions sync on their own,
// so the row offers no second sync for them.
export const SyncRow = ({
  onSyncNow,
  onOpenSyncDetails,
}: {
  onSyncNow: () => void;
  onOpenSyncDetails: () => void;
}) => {
  const statusQuery = useVaultStatus();
  const agentWorking = useAgentWorking();
  const session = useCloudSession();
  const [signInOpen, setSignInOpen] = useState(false);
  const status = statusQuery.data;
  const canSync = canSyncNow(status);
  const note = status === undefined ? null : syncStateNote(status);
  const cloud = session.status;
  // a sign-in that landed closes its dialog, or a later sign-out would open it again
  if (cloud?.state === "signed-in" && signInOpen) {
    setSignInOpen(false);
  }
  const handleSignOut = session.signOut;
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
                      status === undefined ? "bg-muted-foreground/40" : syncStateDotClass(status),
                    )}
                  />
                  {status === undefined ? "…" : syncStateLabel(status)}
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
                <DropdownMenuLabel className="max-w-64 whitespace-normal">
                  {note.message}
                </DropdownMenuLabel>
              )}
              <DropdownMenuItem disabled={!canSync} onClick={onSyncNow}>
                <RefreshCwIcon />
                Sync now
              </DropdownMenuItem>
              {status !== undefined && syncNeedsAttention(status) ? (
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
        <SignInDialog
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

export interface SidebarRailContentProps {
  openPath: string | null;
  onOpenFile: (path: string) => void;
  ops: TreeOps;
  onMoveRequest: (path: string) => void;
  // the view and the tag: the workspace's, since a `#tag` chip in the note shows Recent scoped
  // to the tag, and a create shows Files
  view: RailView;
  onViewChange: (view: RailView) => void;
  selectedTag: string | null;
  onSelectTag: (tag: string | null) => void;
  // the breadcrumb's ask, applied to the tree's state: open the way to this entry and select it;
  // the tree says once it has focused the row, so the owner can clear it
  reveal: TreeReveal | null;
  onRevealConsumed: () => void;
  // the header's Search opens the one palette; the chord is spelled by the workspace's table
  onOpenSearch: () => void;
  searchShortcut: string | null;
  onSyncNow: () => void;
  onOpenSettings: (section?: SettingsSection) => void;
}

export const SidebarRailContent = ({
  openPath,
  onOpenFile,
  ops,
  onMoveRequest,
  view,
  onViewChange,
  selectedTag,
  onSelectTag,
  reveal,
  onRevealConsumed,
  onOpenSearch,
  searchShortcut,
  onSyncNow,
  onOpenSettings,
}: SidebarRailContentProps) => {
  const treeQuery = useVaultTree();
  const pinnedPaths = usePinnedPaths();
  const [treeSort, changeSort] = usePref(PREFS.treeSort);
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [insetTitleBar] = useState(hasInsetTitleBar);
  const handleSetPinned = ops.setPinned;

  const entries = treeQuery.data?.entries ?? EMPTY_ENTRIES;
  const listed = useMemo(() => visibleEntries(entries), [entries]);
  // the breadcrumb's reveal and the open note land on the fold state the rail owns, during the
  // rail's own render; the tree focuses the revealed row its next render draws
  const tree = useTreeState({ entries: listed, onRevealConsumed, openPath, reveal });

  // The group's create is a note; a folder is the tree's right-click.
  const startCreate = (): void => {
    onViewChange("files");
    tree.startCreateInSelection("file");
  };

  const list = (): React.ReactNode => {
    switch (view) {
      case "deleted": {
        return <DeletedNotes onOpenNote={onOpenFile} />;
      }
      case "recent": {
        if (selectedTag !== null) {
          return (
            <TaggedNotes
              key={selectedTag}
              tag={selectedTag}
              onSelectTag={onSelectTag}
              entries={listed}
              openPath={openPath}
              onOpenFile={onOpenFile}
              onSetPinned={handleSetPinned}
            />
          );
        }
        return (
          <NotesList
            entries={listed}
            openPath={openPath}
            onOpenFile={onOpenFile}
            onSetPinned={handleSetPinned}
            limit={RECENT_LIMIT}
          />
        );
      }
      case "files": {
        return (
          <FileTree
            entries={listed}
            loadState={treeLoadState(treeQuery)}
            onRetry={() => {
              void treeQuery.refetch();
            }}
            openPath={openPath}
            onOpenFile={onOpenFile}
            ops={ops}
            state={tree}
            onMoveRequest={onMoveRequest}
            pinnedPaths={pinnedPaths}
            sort={treeSort}
            onSortChange={changeSort}
            vaultRoot={treeQuery.data?.root ?? null}
          />
        );
      }
      default: {
        const exhaustive: never = view;
        return exhaustive;
      }
    }
  };

  // Fluid's sidebar anatomy: the vault row and Search share the header line; one group whose
  // label names the view and opens the view menu, with New note as the group's action; the sync
  // row, Settings and the theme in the footer. Every other verb is a right-click.
  return (
    <>
      <SidebarHeader>
        {insetTitleBar ? (
          <div aria-hidden="true" className="h-5 shrink-0 [-webkit-app-region:drag]" />
        ) : null}
        <div className="flex items-center gap-1 pr-1.5">
          <div className="min-w-0 flex-1">
            <VaultRow vaultName={treeQuery.data?.name ?? "Vault"} />
          </div>
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
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <SidebarGroupLabel aria-label={`View: ${RAIL_VIEW_LABELS[view]}`}>
                  {RAIL_VIEW_LABELS[view]}
                  <ChevronDownIcon size={12} strokeWidth={1.5} className="shrink-0" />
                </SidebarGroupLabel>
              }
            />
            <DropdownMenuContent align="start" sideOffset={2}>
              {RAIL_VIEWS.map((name) => (
                <DropdownMenuItem
                  key={name}
                  onClick={() => {
                    onViewChange(name);
                  }}
                >
                  {RAIL_VIEW_LABELS[name]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <SidebarGroupActions>
            <Tooltip content="New note" side="top">
              <SidebarGroupAction aria-label="New note" onClick={startCreate}>
                <PlusIcon />
              </SidebarGroupAction>
            </Tooltip>
          </SidebarGroupActions>
          {list()}
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center gap-1 pr-1.5">
          <SyncRow
            onSyncNow={onSyncNow}
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
