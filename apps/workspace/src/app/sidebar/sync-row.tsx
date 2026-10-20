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
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@repo/ui/components/sidebar-menu";
import { Spinner } from "@repo/ui/components/spinner";
import { cn } from "@repo/ui/lib/cn";
import type { CloudStatusResponse } from "@repo/contract/local/cloud/cloud-schema";
import type { VaultStatusResponse } from "@repo/contract/local/vault/vault-schema";
import { ChevronsUpDownIcon, InfoIcon, LogInIcon, LogOutIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { useAgentWorking } from "../actions/thread-hooks";
import { useCloudSession } from "../cloud-session";
import type { CloudSession } from "../cloud-session";
import { AccountForm } from "../account-form";
import {
  canSyncNow,
  syncNeedsAttention,
  syncStateDotClass,
  syncStateLabel,
  syncStateNote,
  UPDATE_TO_SYNC,
  useVaultStatus,
} from "../vault-hooks";

// The account the rail's sync row offers, over the same flow Settings › Account runs.
const AccountDialog = ({
  cloudUrl,
  session,
  vault,
  open,
  onOpenChange,
}: {
  cloudUrl: string;
  session: CloudSession;
  vault: VaultStatusResponse | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-sm">
      <DialogHeader>
        <DialogTitle>Sign in or create an account</DialogTitle>
        <DialogDescription>Signed out, this app makes no cloud requests at all.</DialogDescription>
      </DialogHeader>
      <AccountForm cloudUrl={cloudUrl} session={session} vault={vault} />
    </DialogContent>
  </Dialog>
);

// a sign-in replaces a credential the cloud refused, or gives a device one; a build the cloud
// refuses needs an update instead
const offersSignIn = (cloud: CloudStatusResponse | undefined): boolean =>
  cloud?.state === "signed-out" || cloud?.state === "unauthorized";

// a vault of the user's own still syncs, so only the account says this build is refused
const accountNote = (
  cloud: CloudStatusResponse | undefined,
  vault: VaultStatusResponse | undefined,
): string | null =>
  cloud?.state === "outdated" && vault?.state !== "outdated" ? UPDATE_TO_SYNC : null;

// The rail's ambient row: the vault's sync state as the row, and behind it the verbs that change
// it — a sync now, and the account this device does or does not have. Actions stay on this Mac,
// so the library is the one thing the row syncs.
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
  const outdatedNote = accountNote(cloud, status);
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
              {outdatedNote === null ? null : (
                <DropdownMenuLabel className="max-w-64 whitespace-normal">
                  {outdatedNote}
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
              {offersSignIn(cloud) ? (
                <DropdownMenuItem
                  onClick={() => {
                    setSignInOpen(true);
                  }}
                >
                  <LogInIcon />
                  Sign in…
                </DropdownMenuItem>
              ) : null}
              {cloud?.state === "signed-in" ? (
                <>
                  <DropdownMenuLabel className="max-w-64 truncate">
                    {cloud.accountEmail}
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
          vault={status}
          open={signInOpen}
          onOpenChange={setSignInOpen}
        />
      )}
    </>
  );
};
