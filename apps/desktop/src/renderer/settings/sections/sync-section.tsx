import { useCallback, useEffect, useState } from "react";
import { Button } from "@repo/ui/components/button";
import { confirm } from "@repo/ui/components/confirm-dialog";
import { Label } from "@repo/ui/components/label";

import { getBridge } from "@renderer/lib/bridge";
import { SettingSwitchRow } from "@renderer/settings/sections/setting-switch-row";
import { useVaultActions } from "@renderer/workspace/vault-context";
import { basenamePath } from "@repo/notes/knowledge/vault-path";
import type { SyncStatus } from "@repo/notes/sync/status";
import type { SyncState } from "@repo/bridge/sync";

// Human-readable summary of the last reconcile pass for the status line.
function formatSyncStatus(status: SyncStatus): string {
  switch (status.phase) {
    case "idle":
      return "Not synced yet.";
    case "syncing":
      return "Syncing…";
    case "error":
      return `Error: ${status.message}`;
    case "ok": {
      const parts: string[] = [];
      if (status.pushed > 0) parts.push(`${status.pushed} pushed`);
      if (status.pulled > 0) parts.push(`${status.pulled} pulled`);
      if (status.deleted > 0) parts.push(`${status.deleted} deleted`);
      if (status.merged > 0) parts.push(`${status.merged} merged`);
      if (status.conflicts > 0) {
        parts.push(`${status.conflicts} conflict${status.conflicts === 1 ? "" : "s"}`);
      }
      return parts.length === 0 ? "Up to date." : `Synced — ${parts.join(", ")}.`;
    }
  }
}

// Vault sync — reconcile the local vault against the coordinator Worker. Sync
// CONSUMES the account the Account section establishes (#459): the sign-in
// form, server URL, and session live there — this section is only the enable
// toggle, the status line, and the conflict list. Signed out, it defers to
// the Account section instead of duplicating a login. The whole surface
// reaches the backend through the injected Bridge only; onSyncStateChanged
// keeps it reactive across config/auth/status changes.
export function SyncSection({ onRequestClose }: { onRequestClose?: (() => void) | undefined }) {
  const [state, setSyncView] = useState<SyncState | null>(null);
  const [busy, setBusy] = useState(false);
  const { openFile, deleteEntry } = useVaultActions();

  useEffect(() => {
    const bridge = getBridge();
    void bridge
      .getSyncState()
      .then((initial) => {
        setSyncView(initial);
        return undefined;
      })
      .catch(() => {});
    return bridge.onSyncStateChanged(setSyncView);
  }, []);

  const handleToggle = useCallback((next: boolean) => {
    void getBridge()
      .setSyncConfig({ enabled: next })
      .then(setSyncView)
      .catch(() => {});
  }, []);

  const handleSyncNow = useCallback(async () => {
    const bridge = getBridge();
    setBusy(true);
    try {
      await bridge.syncNow();
    } finally {
      setBusy(false);
    }
  }, []);

  // Reviewing a conflict is a workspace act — close the dialog, show the note.
  const handleOpenConflict = useCallback(
    (path: string) => {
      onRequestClose?.();
      openFile(path);
    },
    [onRequestClose, openFile],
  );

  // Dismissing deletes the conflict COPY file (the sibling holding the losing
  // version) — the canonical note is untouched. The host prunes resolved rows
  // on the next state read, so refresh promptly after the delete lands.
  const handleDismissConflict = useCallback(
    async (path: string) => {
      const confirmed = await confirm({
        title: "Delete this conflict copy?",
        body: `The conflict copy file “${path}” will be deleted from your vault. The note it was copied from is not touched.`,
        confirmLabel: "Delete copy",
        destructive: true,
      });
      if (!confirmed) return;
      setBusy(true);
      try {
        await deleteEntry(path);
        setSyncView(await getBridge().getSyncState());
      } finally {
        setBusy(false);
      }
    },
    [deleteEntry],
  );

  const loading = state === null;
  const signedIn = state?.signedIn === true;
  const conflicts = state?.conflicts ?? [];

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-medium text-muted-foreground">Sync</Label>
      <div className="rounded-[12px] bg-muted">
        <SettingSwitchRow
          label="Vault sync"
          checked={state?.enabled === true}
          onToggle={() => handleToggle(state?.enabled !== true)}
          disabled={loading}
        />
        <div className="flex flex-col gap-2 px-3 pb-2">
          <p className="text-[10px] text-muted-foreground">
            Mirror your vault to the server. Only markdown and attachments sync — never the
            knowledge index or AI state. Notes marked <code>private: true</code> are excluded from
            AI features on this device but still sync to the server unencrypted.
          </p>

          {!signedIn && (
            <p className="rounded-[8px] bg-card px-2.5 py-1.5 text-[10px] text-muted-foreground">
              Cloud saves need an account — sign in under Account above. Everything else already
              works without one.
            </p>
          )}

          <div className="flex items-center justify-between border-t border-border pt-2">
            <span className="text-[10px] text-muted-foreground">
              {loading ? "Checking…" : formatSyncStatus(state.status)}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleSyncNow()}
              disabled={busy || loading || !signedIn || state?.enabled !== true}
              className="h-auto px-2 py-0.5 text-[10px] text-muted-foreground"
            >
              Sync now
            </Button>
          </div>

          {conflicts.length > 0 && (
            <div className="flex flex-col gap-1.5 border-t border-border pt-2">
              <span className="text-[10px] text-muted-foreground">
                Conflicts — a sync kept both versions of these notes. The losing side was saved as a
                copy: review it, fold anything worth keeping into the note, then dismiss the copy.
              </span>
              {conflicts.map((conflict) => (
                <div
                  key={conflict.path}
                  className="flex items-center justify-between gap-2 rounded-[8px] bg-card px-2.5 py-1.5"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-xs text-foreground">
                      {basenamePath(conflict.path)}
                    </span>
                    <span className="truncate text-[10px] text-muted-foreground">
                      {conflict.path}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleOpenConflict(conflict.path)}
                      className="h-auto px-2 py-0.5 text-[10px] text-muted-foreground"
                    >
                      Open
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleDismissConflict(conflict.path)}
                      disabled={busy}
                      className="h-auto px-2 py-0.5 text-[10px] text-muted-foreground"
                    >
                      Dismiss copy
                    </Button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
