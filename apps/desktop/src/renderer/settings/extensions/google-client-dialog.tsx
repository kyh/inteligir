// ---------------------------------------------------------------------------
// Google OAuth app registration. Google has no dynamic client registration;
// normally the build's bundled "Desktop app" client is auto-seeded by main
// and this dialog never shows. It remains for two paths: the fallback when
// a build carries no bundled client and none is registered yet (a Google
// connect lands here), and the advanced "use your own Google OAuth client"
// override for self-hosters/devs. Either way the pasted GCP client (id +
// secret, redirect URI whitelisted in that app) is stored in executor under
// the shared "google" slug and reused by every Google connector.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";

import { Button } from "@repo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import { Input } from "@repo/ui/components/input";

import { blockDismissWhileBusy } from "@/renderer/settings/extensions/lib";

type Props = {
  open: boolean;
  /** The daemon's OAuth callback to whitelist in the GCP app (null = daemon down). */
  redirectUri: string | null;
  busy: boolean;
  /** A failure to show inside the dialog (the panel error is hidden behind it). */
  error: string | null;
  onCancel: () => void;
  onSubmit: (clientId: string, clientSecret: string) => void;
};

export function GoogleClientDialog({ open, redirectUri, busy, error, onCancel, onSubmit }: Props) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  useEffect(() => {
    if (open) {
      setClientId("");
      setClientSecret("");
    }
  }, [open]);

  const trimmedId = clientId.trim();
  const trimmedSecret = clientSecret.trim();
  const canSubmit = !busy && trimmedId.length > 0 && trimmedSecret.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={blockDismissWhileBusy(busy, (next) => {
        if (!next) onCancel();
      })}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set up Google sign-in</DialogTitle>
          <DialogDescription>
            Google requires your own OAuth app (one-time setup, shared by all Google connectors).
            Create an OAuth client ID in the Google Cloud console, add the redirect URI below to it,
            and paste its credentials here.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {/* Inside-glass info well: lighter translucent row, white text. */}
          <div className="flex flex-col gap-1 rounded-[10px] bg-glass-row px-3 py-2">
            <span className="text-[10px] font-medium text-glass-fg-muted">
              Authorized redirect URI (add to your OAuth client in GCP)
            </span>
            <code className="select-all break-all text-[11px] text-glass-fg">
              {redirectUri ?? "Executor isn't running — start the app's agent first."}
            </code>
          </div>
          <Input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="Client ID (…apps.googleusercontent.com)"
            autoFocus
            className="h-8 text-xs"
          />
          <Input
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder="Client secret"
            className="h-8 text-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSubmit) onSubmit(trimmedId, trimmedSecret);
            }}
          />
          {error && <div className="text-[10px] text-[#ffb4ab]">{error}</div>}
          <Button
            variant="primary"
            size="sm"
            onClick={() => canSubmit && onSubmit(trimmedId, trimmedSecret)}
            disabled={!canSubmit}
            className="h-8 self-end px-4 text-[11px]"
          >
            {busy ? "Connecting…" : "Save & continue"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
