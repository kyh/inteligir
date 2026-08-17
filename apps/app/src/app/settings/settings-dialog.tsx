// Minimal settings: what the server already answers (vault location, git
// remote, sync state, the agent block of /system/status, the About block)
// plus the one client-side preference that exists today (theme). The remote
// is display-only — changing it rides INTELIGIR_VAULT_REMOTE / config.json
// until a config route exists.

import { Button } from "@repo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import { Separator } from "@repo/ui/components/separator";
import { cn } from "@repo/ui/lib/utils";
import { useTheme, type Theme } from "@repo/ui/lib/theme";
import {
  canSyncNow,
  syncStateLabel,
  useSystemStatus,
  useVaultStatus,
  useVaultTree,
} from "../vault-hooks";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] items-baseline gap-x-4 gap-y-1 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-medium tracking-wide text-muted-foreground">{children}</h3>;
}

const THEMES: readonly { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSyncNow: () => void;
}

/**
 * The dialog is mounted for the whole session and shut for almost all of it,
 * so its three queries live in the BODY — which the dialog only renders while
 * it is open. `useSystemStatus` has no other subscriber at all, so a closed
 * dialog was the only reason this app ever fetched it.
 */
export function SettingsDialog({ open, onOpenChange, onSyncNow }: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription className="sr-only">Workspace settings</DialogDescription>
        </DialogHeader>
        <SettingsBody onSyncNow={onSyncNow} />
      </DialogContent>
    </Dialog>
  );
}

function SettingsBody({ onSyncNow }: { onSyncNow: () => void }) {
  const treeQuery = useVaultTree();
  const statusQuery = useVaultStatus();
  const systemQuery = useSystemStatus();
  const { theme, setTheme } = useTheme();

  const status = statusQuery.data;
  const system = systemQuery.data;

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <SectionHeading>Vault</SectionHeading>
        <dl className="space-y-1.5">
          <Row label="Location">
            <span className="block truncate font-mono text-xs" title={treeQuery.data?.root}>
              {treeQuery.data?.root ?? "…"}
            </span>
          </Row>
          <Row label="Git remote">
            {status === undefined ? (
              "…"
            ) : status.state === "no-remote" ? (
              <span className="text-muted-foreground">
                None — set INTELIGIR_VAULT_REMOTE or config.json to sync.
              </span>
            ) : (
              <span className="block truncate font-mono text-xs" title={status.remote}>
                {status.remote}
              </span>
            )}
          </Row>
          <Row label="Sync">
            <span className="flex items-center gap-2">
              {status === undefined ? "…" : syncStateLabel(status)}
              {canSyncNow(status) ? (
                <Button variant="outline" size="xs" onClick={onSyncNow}>
                  Sync now
                </Button>
              ) : null}
            </span>
            {status?.lastError !== null && status?.lastError !== undefined ? (
              <span className="mt-1 block text-xs text-muted-foreground">
                Last error: {status.lastError}
              </span>
            ) : null}
          </Row>
        </dl>
      </section>
      <Separator />
      <section className="space-y-2">
        <SectionHeading>Agent</SectionHeading>
        <dl className="space-y-1.5">
          <Row label="Mode">
            <span className="font-mono text-xs">{system?.agent.mode ?? "…"}</span>
          </Row>
          <Row label="Runtime">
            <span className="font-mono text-xs">{system?.agent.runtime ?? "…"}</span>
          </Row>
          {system !== undefined && system.agent.detail !== null ? (
            <Row label="Detail">
              <span className="text-xs text-muted-foreground">{system.agent.detail}</span>
            </Row>
          ) : null}
        </dl>
      </section>
      <Separator />
      <section className="space-y-2">
        <SectionHeading>Appearance</SectionHeading>
        <div className="flex gap-1" role="radiogroup" aria-label="Theme">
          {THEMES.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={theme === option.value}
              className={cn(
                "rounded-md border px-3 py-1 text-sm",
                theme === option.value
                  ? "border-ring bg-muted text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted/50",
              )}
              onClick={() => setTheme(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>
      <Separator />
      <section className="space-y-2">
        <SectionHeading>About</SectionHeading>
        <dl className="space-y-1.5">
          <Row label="Version">
            <span className="font-mono text-xs">{system?.version ?? "…"}</span>
          </Row>
          <Row label="Data dir">
            <span className="block truncate font-mono text-xs" title={system?.dataDir}>
              {system?.dataDir ?? "…"}
            </span>
          </Row>
          <Row label="Schema">
            <span className="font-mono text-xs">
              {system === undefined ? "…" : `v${system.schemaVersion}`}
            </span>
          </Row>
          <Row label="Uptime">
            <span className="font-mono text-xs">
              {system === undefined ? "…" : `${Math.round(system.uptimeMs / 1000)}s`}
            </span>
          </Row>
        </dl>
      </section>
    </div>
  );
}
