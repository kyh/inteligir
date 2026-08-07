import { useCallback, useId, useState } from "react";

import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { cn } from "@repo/ui/lib/utils";

import { accountPort } from "@repo/workspace/workspace/account-host";

// Account — who is signed in, the way to take the notes with you, and the two
// ways out. Everything else a workspace can see is already scoped to this
// account, so there is nothing to configure here.
//
// The export is an ordinary link, deliberately: the host streams the archive
// and the browser writes it to disk, so there is no progress to render and no
// state to hold. A button that fetched it would have to buffer a vault.
//
// Absent port = a surface that mounted the workspace without an account
// concept. It renders nothing rather than an empty box.
export function AccountSection() {
  const port = accountPort();
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const passwordId = useId();

  const handleSignOut = useCallback(() => {
    if (port === null) return;
    setBusy(true);
    void (async () => {
      try {
        await port.signOut();
      } finally {
        // The sign-out navigates away on success, so this only matters when it
        // failed and the button has to become pressable again.
        setBusy(false);
      }
    })();
  }, [port]);

  const handleDelete = useCallback(() => {
    if (port === null) return;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const outcome = await port.deleteAccount(password === "" ? null : password);
        if (!outcome.ok) setError(outcome.error);
      } finally {
        setBusy(false);
      }
    })();
  }, [password, port]);

  if (port === null) return null;

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-medium text-muted-foreground">Account</Label>
      <div className="flex items-center justify-between gap-3 rounded-[12px] bg-muted px-3 py-2">
        <p className="min-w-0 truncate text-[11px]">{port.email}</p>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={handleSignOut}
          className="h-7 shrink-0 px-2 text-xs"
        >
          {busy ? "Working…" : "Sign out"}
        </Button>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-[10px] bg-muted px-3 py-2">
        <span className="flex min-w-0 flex-col">
          <span className="text-xs text-foreground">Export vault</span>
          <span className="text-[10px] text-muted-foreground">
            Every note and attachment as a zip of plain markdown files.
          </span>
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-7 shrink-0 px-2 text-xs"
          render={
            <a href={port.exportVaultUrl} download>
              Download
            </a>
          }
        />
      </div>

      <div className="flex flex-col gap-2 rounded-[10px] bg-muted px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 flex-col">
            <span className="text-xs text-foreground">Delete account</span>
            <span className="text-[10px] text-muted-foreground">
              Erases your notes, their history and this account. Export first — this cannot be
              undone.
            </span>
          </span>
          {/* Hidden rather than unmounted: a Settings button that removes itself
              on click is read as an outside press and dismisses the dialog. */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDeleting(true)}
            className={cn(
              "h-auto shrink-0 px-2 py-0.5 text-[10px] text-destructive",
              deleting && "hidden",
            )}
          >
            Delete…
          </Button>
        </div>
        {deleting && (
          <div className="flex flex-col gap-2">
            <Label htmlFor={passwordId} className="text-[10px] text-muted-foreground">
              Password (leave empty if you signed in with Google or GitHub)
            </Label>
            <Input
              id={passwordId}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-7 text-xs"
            />
            {error !== null && <p className="text-[10px] text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={handleDelete}
                className="h-7 px-2 text-xs"
              >
                {busy ? "Deleting…" : "Delete everything"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setDeleting(false);
                  setPassword("");
                  setError(null);
                }}
                className="h-7 px-2 text-xs"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
