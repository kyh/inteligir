import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@repo/ui/components/sidebar-menu";
import { ChevronDownIcon, FolderOpenIcon, VaultIcon } from "lucide-react";
import { toast } from "@repo/ui/components/sonner";
import {
  openRecentVault,
  pickVault,
  RecentVaultLabel,
  useDesktopVaults,
  useVaultSwitch,
} from "../desktop-vaults";

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
// folder is picked in the shell, so this is a menu over what the shell remembers. A browser tab
// has no bridge and did not start the server, so it gets the name alone.
export const VaultRow = ({ vaultName }: { vaultName: string }) => {
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
