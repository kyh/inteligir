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

import type { CatalogConnector } from "@/renderer/settings/extensions/connector-catalog";
import { blockDismissWhileBusy } from "@/renderer/settings/extensions/lib";

type Props = {
  /** The connector requesting a key, or null when the dialog is closed. */
  connector: CatalogConnector | null;
  /** The secretLabel describing what to paste (from the connector's apiKey auth). */
  label: string;
  busy: boolean;
  /** A connect failure to show inside the dialog (the panel error is hidden behind it). */
  error: string | null;
  onCancel: () => void;
  onSubmit: (value: string) => void;
};

export function SecretPromptDialog({ connector, label, busy, error, onCancel, onSubmit }: Props) {
  const [value, setValue] = useState("");

  useEffect(() => {
    if (connector) setValue("");
  }, [connector]);

  const trimmed = value.trim();
  const canSubmit = !busy && trimmed.length > 0;

  return (
    <Dialog
      open={connector !== null}
      // Block dismissal mid-submit — a stray close could leave a stored secret
      // with no source. The submit flow owns closing (via onCancel on close).
      onOpenChange={blockDismissWhileBusy(busy, (open) => {
        if (!open) onCancel();
      })}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect {connector?.name}</DialogTitle>
          <DialogDescription>{label}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={label}
            autoFocus
            className="h-8 text-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSubmit) onSubmit(trimmed);
            }}
          />
          {/* Destructive token is tuned for opaque surfaces; #ffb4ab reads on glass. */}
          {error && <div className="text-[10px] text-[#ffb4ab]">{error}</div>}
          <Button
            variant="primary"
            size="sm"
            onClick={() => canSubmit && onSubmit(trimmed)}
            disabled={!canSubmit}
            className="h-8 self-end px-4 text-[11px]"
          >
            {busy ? "Connecting…" : "Connect"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
