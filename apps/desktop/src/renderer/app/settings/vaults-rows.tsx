import { Button } from "@repo/ui/components/button";
import { XIcon } from "lucide-react";
import { useState } from "react";
import { forgetRecentVault, openRecentVault, pickVault, useDesktopVaults } from "../desktop-vaults";
import { failed, Row } from "./settings-chrome";

type Busy = "picking" | "opening" | "forgetting";

// rendered only under the shell: a browser tab did not start the server it talks to
export function VaultsRow() {
  const vaults = useDesktopVaults();
  const [busy, setBusy] = useState<Busy | null>(null);
  if (vaults.kind !== "state") {
    return null;
  }
  const { state } = vaults;
  const run = (kind: Busy, work: () => Promise<void>): void => {
    setBusy(kind);
    void work()
      .catch((cause: unknown) => {
        failed(cause, "Could not open that vault.");
      })
      .finally(() => {
        setBusy(null);
      });
  };
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
                  <span className="block truncate text-sm">{vault.name}</span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">
                    {vault.path}
                  </span>
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
