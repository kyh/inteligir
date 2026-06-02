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

type Props = {
  /** The connector requesting a key, or null when the dialog is closed. */
  connector: CatalogConnector | null;
  /** The secretLabel describing what to paste (from the connector's apiKey auth). */
  label: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (value: string) => void;
};

export function SecretPromptDialog({ connector, label, busy, onCancel, onSubmit }: Props) {
  const [value, setValue] = useState("");

  useEffect(() => {
    if (connector) setValue("");
  }, [connector]);

  return (
    <Dialog open={connector !== null} onOpenChange={(o) => !o && onCancel()}>
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
              if (e.key === "Enter" && value.trim() && !busy) onSubmit(value.trim());
            }}
          />
          <Button
            variant="default"
            size="sm"
            onClick={() => value.trim() && onSubmit(value.trim())}
            disabled={busy || !value.trim()}
            className="h-8 self-end px-4 text-[11px]"
          >
            {busy ? "Connecting…" : "Connect"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
