import { Button } from "@repo/ui/components/button";
import { XIcon } from "lucide-react";
import {
  forgetRecentVault,
  openRecentVault,
  pickVault,
  RecentVaultLabel,
  useDesktopVaults,
  useVaultSwitch,
} from "../desktop-vaults";
import { toast } from "@repo/ui/components/sonner";
import { Row } from "./settings-chrome";

// rendered only under the shell: a browser tab did not start the server it talks to
export function VaultsRow() {
  const vaults = useDesktopVaults();
  const { busy, run } = useVaultSwitch(toast.error);
  if (vaults.kind !== "state") {
    return null;
  }
  const { state } = vaults;
  const switchable = state.blocked === null;
  return (
    <Row label="Vaults">
      <div className="space-y-2">
        {switchable ? (
          <Button
            variant="tertiary"
            size="compact"
            disabled={busy !== null}
            onClick={() => {
              run("picking", pickVault);
            }}
          >
            {busy === "picking" || busy === "opening" ? "Opening…" : "Open another vault…"}
          </Button>
        ) : (
          <span className="block text-sm text-muted-foreground">{state.blocked}</span>
        )}
        {state.recent.length > 0 ? (
          <ul className="space-y-0.5">
            {state.recent.map((vault) => (
              <li key={vault.path} className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={busy !== null || !switchable}
                  className="min-w-0 flex-1 rounded-md px-1.5 py-1 text-left hover:bg-hover disabled:pointer-events-none disabled:opacity-50"
                  onClick={() => {
                    run("opening", () => openRecentVault(vault.path));
                  }}
                >
                  <RecentVaultLabel vault={vault} />
                </button>
                <Button
                  variant="ghost"
                  size="icon-compact"
                  aria-label={`Forget ${vault.name}`}
                  disabled={busy !== null}
                  onClick={() => {
                    run("forgetting", () => forgetRecentVault(vault.path));
                  }}
                >
                  <XIcon />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Row>
  );
}
