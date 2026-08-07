import { useCallback, useState } from "react";

import { Button } from "@repo/ui/components/button";
import { Label } from "@repo/ui/components/label";

import { accountPort } from "@repo/workspace/workspace/account-host";

// Account — who is signed in, and the way out. Everything a workspace can see
// is already scoped to this account, so there is nothing to configure here and
// no other state to show: the section exists for the one action the host
// deliberately does not serve (account-host.ts).
//
// Absent port = a surface that mounted the workspace without an account
// concept. It renders nothing rather than an empty box.
export function AccountSection() {
  const port = accountPort();
  const [busy, setBusy] = useState(false);

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
          {busy ? "Signing out…" : "Sign out"}
        </Button>
      </div>
    </div>
  );
}
