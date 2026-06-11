// ---------------------------------------------------------------------------
// One-time Google OAuth app registration. Google has no dynamic client
// registration, so before the first Google connector can run its consent flow
// the user must paste their own GCP OAuth client (id + secret) and whitelist
// the daemon's redirect URI in that app. The client is stored in executor
// under the shared "google" slug and reused by every Google connector.
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

import type { CatalogConnector } from "@/renderer/shell/builtin/extensions/connector-catalog";
import { blockDismissWhileBusy } from "@/renderer/shell/builtin/extensions/lib";

type Props = {
  /** The Google connector being connected, or null when the dialog is closed. */
  connector: CatalogConnector | null;
  /** The daemon's OAuth callback to whitelist in the GCP app (null = daemon down). */
  redirectUri: string | null;
  busy: boolean;
  /** A failure to show inside the dialog (the panel error is hidden behind it). */
  error: string | null;
  onCancel: () => void;
  onSubmit: (clientId: string, clientSecret: string) => void;
};

export function GoogleClientDialog({
  connector,
  redirectUri,
  busy,
  error,
  onCancel,
  onSubmit,
}: Props) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  useEffect(() => {
    if (connector) {
      setClientId("");
      setClientSecret("");
    }
  }, [connector]);

  const trimmedId = clientId.trim();
  const trimmedSecret = clientSecret.trim();
  const canSubmit = !busy && trimmedId.length > 0 && trimmedSecret.length > 0;

  return (
    <Dialog
      open={connector !== null}
      onOpenChange={blockDismissWhileBusy(busy, (open) => {
        if (!open) onCancel();
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
          <div className="flex flex-col gap-1 rounded-md border border-border px-3 py-2">
            <span className="text-[10px] font-medium text-muted-foreground">
              Authorized redirect URI (add to your OAuth client in GCP)
            </span>
            <code className="select-all break-all text-[11px] text-foreground">
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
          {error && <div className="text-[10px] text-destructive">{error}</div>}
          <Button
            variant="default"
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
