import { useCallback, useEffect, useState } from "react";

import { Button } from "@repo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";

import { getBridge } from "@renderer/lib/bridge";

// Pops on any agent turn_error with kind === "auth" — main emits that when a
// turn ends silently with no assistant text, no tool call, and no explicit
// pi error event. Single global mount in AppLayout.
export function ReauthDialog() {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = getBridge()?.onAgentEvent((event) => {
      if (event.type === "turn_error" && event.kind === "auth") {
        setReason(event.reason);
        setError(null);
        setOpen(true);
      }
    });
    return () => unsub?.();
  }, []);

  const handleReauth = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await getBridge()?.reauthenticate();
      if (result?.ok) {
        setOpen(false);
      } else {
        setError(result?.error ?? "Re-authentication failed.");
      }
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Re-authenticate?</DialogTitle>
          <DialogDescription>
            {reason ?? "The model returned no response. Your session may have expired."}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <div className="rounded-[10px] bg-muted px-3 py-2 text-xs text-destructive">{error}</div>
        )}
        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={busy}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Dismiss
          </Button>
          <Button
            variant="default"
            onClick={() => void handleReauth()}
            disabled={busy}
            className="text-xs"
          >
            {busy ? "Opening browser…" : "Re-authenticate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
