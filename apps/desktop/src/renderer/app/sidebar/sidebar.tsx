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
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@repo/ui/components/sidebar";
import { Spinner } from "@repo/ui/components/spinner";
import { Tooltip } from "@repo/ui/components/tooltip";
import { useTheme } from "@repo/ui/lib/theme";
import { cn } from "cn";
import { isVaultMetadataPath } from "@repo/notes/knowledge/doc-file";
import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import {
  ChevronDownIcon,
  ChevronsUpDownIcon,
  FolderOpenIcon,
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
import { useThreads } from "../actions/thread-hooks";
import { useCloudSession } from "../cloud-session";
import type { CloudSession } from "../cloud-session";
import {
  openRecentVault,
  pickVault,
  RecentVaultLabel,
  useDesktopVaults,
  useVaultSwitch,
} from "../desktop-vaults";
import { readTreeSort, writeTreeSort } from "../prefs";
import type { RailView, TreeSort } from "../prefs";
import { SignInForm } from "../settings/sync-section";
import { hasInsetTitleBar } from "../title-bar";
import {
  canSyncNow,
  syncBlockedReason,
  syncStateDotClass,
  syncStateLabel,
  usePinnedPaths,
  useVaultStatus,
  useVaultTree,
} from "../vault-hooks";
import { DeletedNotes } from "./deleted-notes";
import { FileTree } from "./file-tree";
import type { PendingCreate, TreeLoadState, TreeOps } from "./file-tree";
import { NotesList } from "./notes-list";
import { TaggedNotes } from "./tagged-notes";
import { createDirFor, revealInTree, useTreeState } from "./tree-state";

const EMPTY_ENTRIES: readonly VaultEntry[] = [];

// the rail draws what the user wrote; the server's listing stays complete for the CLI and the agent
export const visibleEntries = (entries: readonly VaultEntry[]): VaultEntry[] =>
  entries.filter((entry) => !isVaultMetadataPath(entry.path));

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
      <kbd className="-my-1 flex h-4 min-w-4 items-center justify-center rounded border border-background/30 px-1 font-sans text-[10px] text-background/80">
        {shortcut}
      </kbd>
    </span>
  );

// the vault's mark: its initial on a 20px tile, centred on the rows' leading icon axis
const VaultTile = ({ name }: { name: string }) => (
  <span
    aria-hidden="true"
    className="pointer-events-none absolute top-1/2 left-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-md bg-foreground text-[10px] font-semibold text-background"
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
                  run("opening", async () => {
                    await openRecentVault(vault.path);
                  });
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

const RAIL_VIEWS: readonly RailView[] = ["recent", "files", "deleted"];

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
// it — a sync now, and the account this device does or does not have.
const SyncRow = ({ onSyncNow }: { onSyncNow: () => void }) => {
  const statusQuery = useVaultStatus();
  const threadsQuery = useThreads();
  const session = useCloudSession();
  const [signInOpen, setSignInOpen] = useState(false);
  const agentWorking = (threadsQuery.data?.threads ?? []).some(
    (thread) =>
      thread.status === "active" || thread.status === "starting" || thread.status === "stopping",
  );
  const status = statusQuery.data;
  const canSync = canSyncNow(status);
  const blocked = status === undefined ? null : (status.lastError ?? syncBlockedReason(status));
  const cloud = session.status;
  const handleSyncThreads = session.syncThreads;
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
              {blocked === null ? null : (
                <DropdownMenuLabel className="max-w-64 whitespace-normal">
                  {blocked}
                </DropdownMenuLabel>
              )}
              <DropdownMenuItem disabled={!canSync} onClick={onSyncNow}>
                <RefreshCwIcon />
                Sync now
              </DropdownMenuItem>
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
                  <DropdownMenuItem disabled={session.pending} onClick={handleSyncThreads}>
                    <RefreshCwIcon />
                    Sync threads now
                  </DropdownMenuItem>
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
      {cloud === undefined || cloud.state === "signed-in" ? null : (
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
  // the breadcrumb's ask, passed to the tree: open the way to this entry and select it
  reveal: { path: string; nonce: number } | null;
  // the header's Search opens the one palette; the chord is spelled by the workspace's table
  onOpenSearch: () => void;
  searchShortcut: string | null;
  onSyncNow: () => void;
  onOpenSettings: () => void;
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
  onOpenSearch,
  searchShortcut,
  onSyncNow,
  onOpenSettings,
}: SidebarRailContentProps) => {
  const treeQuery = useVaultTree();
  const pinnedPaths = usePinnedPaths();
  const tree = useTreeState();
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(null);
  const [treeSort, setTreeSort] = useState<TreeSort>(readTreeSort);
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [insetTitleBar] = useState(hasInsetTitleBar);
  const handleSetPinned = ops.setPinned;

  const entries = treeQuery.data?.entries ?? EMPTY_ENTRIES;
  const listed = useMemo(() => visibleEntries(entries), [entries]);

  // The breadcrumb's reveal lands on the fold state the rail owns, keyed by the nonce so naming
  // the same entry twice reveals it twice; the tree is handed the same request and focuses the
  // row its next render draws.
  const [appliedReveal, setAppliedReveal] = useState<number | null>(null);
  if (reveal !== null && reveal.nonce !== appliedReveal) {
    setAppliedReveal(reveal.nonce);
    revealInTree(
      tree,
      reveal.path,
      entries.some((entry) => entry.kind === "dir" && entry.path === reveal.path),
    );
  }

  // The group's create is a note; a folder is the tree's right-click. It lands where an IDE's
  // would: in the tree's selected folder, else at the vault root.
  const startCreate = (): void => {
    onViewChange("files");
    setPendingCreate({
      kind: "file",
      parentDir: createDirFor("", tree.activePath, (path) =>
        entries.some((entry) => entry.kind === "dir" && entry.path === path),
      ),
    });
  };
  const changeSort = (next: TreeSort): void => {
    writeTreeSort(next);
    setTreeSort(next);
  };

  const list = (): React.ReactNode => {
    if (view === "deleted") {
      return <DeletedNotes onOpenNote={onOpenFile} />;
    }
    if (view === "recent") {
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
        pendingCreate={pendingCreate}
        onPendingCreateDone={() => {
          setPendingCreate(null);
        }}
        reveal={reveal}
        onMoveRequest={onMoveRequest}
        pinnedPaths={pinnedPaths}
        sort={treeSort}
        onSortChange={changeSort}
        vaultRoot={treeQuery.data?.root ?? null}
      />
    );
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
          <SyncRow onSyncNow={onSyncNow} />
          <Tooltip content="Settings" side="top">
            <Button
              variant="ghost"
              size="icon-compact"
              className="size-6 shrink-0"
              aria-label="Settings"
              onClick={onOpenSettings}
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
