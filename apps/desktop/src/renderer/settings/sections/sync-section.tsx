import { useCallback, useEffect, useState } from "react";
import { Button } from "@repo/ui/components/button";
import { confirm } from "@repo/ui/components/confirm-dialog";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";

import { getBridge } from "@renderer/lib/bridge";
import { SettingSwitchRow } from "@renderer/settings/sections/setting-switch-row";
import { useVault } from "@renderer/workspace/vault-context";
import type { SyncState, SyncStatus } from "@repo/features/sync";

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
      if (status.conflicts > 0) {
        parts.push(`${status.conflicts} conflict${status.conflicts === 1 ? "" : "s"}`);
      }
      return parts.length === 0 ? "Up to date." : `Synced — ${parts.join(", ")}.`;
    }
  }
}

// Vault sync — reconcile the local vault against the coordinator Worker. The
// whole surface reaches the backend through the injected Bridge only; the host
// owns the config store, the bearer session, and the engine lifecycle. The
// onSyncStateChanged subscription keeps this reactive across config/auth/status
// changes (including a background pass finishing). The coordinator URL field is
// kept local so an in-flight edit isn't clobbered by a pushed state update.
export function SyncSection({ onRequestClose }: { onRequestClose?: (() => void) | undefined }) {
  const [state, setSyncView] = useState<SyncState | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { openFile, deleteEntry } = useVault();

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    void bridge
      .getSyncState()
      .then((initial) => {
        setSyncView(initial);
        setUrlInput(initial.coordinatorUrl);
        return undefined;
      })
      .catch(() => {});
    return bridge.onSyncStateChanged(setSyncView);
  }, []);

  const patchConfig = useCallback(async (patch: { enabled?: boolean; coordinatorUrl?: string }) => {
    const bridge = getBridge();
    if (!bridge) return;
    setError(null);
    const next = await bridge.setSyncConfig(patch);
    setSyncView(next);
  }, []);

  const handleToggle = useCallback(
    (next: boolean) => {
      void patchConfig({ enabled: next });
    },
    [patchConfig],
  );

  const handleSaveUrl = useCallback(() => {
    void patchConfig({ coordinatorUrl: urlInput.trim() });
  }, [patchConfig, urlInput]);

  const handleSignIn = useCallback(async () => {
    const bridge = getBridge();
    if (!bridge) return;
    setBusy(true);
    setError(null);
    try {
      // Persist any pending URL edit first so sign-in hits the right coordinator.
      if (urlInput.trim() !== (state?.coordinatorUrl ?? "")) {
        await bridge.setSyncConfig({ coordinatorUrl: urlInput.trim() });
      }
      const result = await bridge.syncSignIn({ email, password });
      if (result.ok) {
        setPassword("");
      } else {
        setError(result.error);
      }
    } catch {
      setError("Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }, [email, password, urlInput, state]);

  const handleSignOut = useCallback(async () => {
    const bridge = getBridge();
    if (!bridge) return;
    setBusy(true);
    try {
      await bridge.syncSignOut();
    } finally {
      setBusy(false);
    }
  }, []);

  const handleSyncNow = useCallback(async () => {
    const bridge = getBridge();
    if (!bridge) return;
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
        const next = await getBridge()?.getSyncState();
        if (next) setSyncView(next);
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
            Mirror your vault to the coordinator. Only markdown and attachments sync — never the
            knowledge index or AI state.
          </p>

          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-muted-foreground">Coordinator URL</span>
            <Input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onBlur={handleSaveUrl}
              placeholder="https://sync.inteligir.app"
              className="h-7 text-xs"
              disabled={loading}
            />
          </div>

          {signedIn ? (
            <div className="flex items-center justify-between rounded-[8px] bg-card px-2.5 py-1.5">
              <span className="flex flex-col">
                <span className="text-xs text-foreground">Signed in</span>
                <span className="text-[10px] text-muted-foreground">{state?.email ?? ""}</span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleSignOut()}
                disabled={busy}
                className="h-auto px-2 py-0.5 text-[10px] text-muted-foreground"
              >
                Sign out
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                type="email"
                autoComplete="username"
                className="h-7 text-xs"
                disabled={loading}
              />
              <Input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                type="password"
                autoComplete="current-password"
                className="h-7 text-xs"
                disabled={loading}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleSignIn()}
                disabled={busy || loading || email.trim() === "" || password === ""}
                className="h-7 self-start px-3 text-[10px]"
              >
                {busy ? "Signing in…" : "Sign in"}
              </Button>
            </div>
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
                      {conflict.path.split("/").at(-1) ?? conflict.path}
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

          {error && <span className="text-[10px] text-destructive">{error}</span>}
        </div>
      </div>
    </div>
  );
}
