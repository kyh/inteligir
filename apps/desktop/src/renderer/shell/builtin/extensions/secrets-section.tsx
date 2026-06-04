import { useCallback, useState } from "react";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";

import { getBridge } from "@/renderer/lib/bridge";
import {
  errorMessage,
  useBridgeResource,
  type SectionProps,
} from "@/renderer/shell/builtin/extensions/lib";

export function SecretsSection({ onError }: SectionProps) {
  const { data: secrets, refresh } = useBridgeResource((b) => b.listExecutorSecrets(), onError);
  const [id, setId] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const handleAdd = useCallback(async () => {
    if (!id.trim() || !value.trim()) {
      onError("Secret id and value are required.");
      return;
    }
    setBusy(true);
    onError(null);
    try {
      await getBridge()?.setExecutorSecret({ id: id.trim(), name: id.trim(), value: value.trim() });
      setId("");
      setValue("");
      refresh();
    } catch (err) {
      onError(errorMessage(err, "Failed to save secret."));
    } finally {
      setBusy(false);
    }
  }, [id, value, onError, refresh]);

  const handleRemove = useCallback(
    async (secretId: string) => {
      try {
        await getBridge()?.removeExecutorSecret(secretId);
        refresh();
      } catch (err) {
        onError(errorMessage(err, "Failed to remove secret."));
      }
    },
    [onError, refresh],
  );

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-medium text-muted-foreground">Secrets</Label>
      {secrets && secrets.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {secrets.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-xs text-foreground">{s.name}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleRemove(s.id)}
                className="h-auto px-2 py-0.5 text-[10px] text-muted-foreground"
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-1.5 rounded-md border border-border px-3 py-2">
        <span className="text-[10px] font-medium text-muted-foreground">Add secret</span>
        <Input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="Secret id (e.g. github-token)"
          className="h-7 text-xs"
        />
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Value"
          type="password"
          className="h-7 text-xs"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleAdd()}
          disabled={busy}
          className="h-7 self-start px-3 text-[10px]"
        >
          {busy ? "Saving…" : "Save secret"}
        </Button>
      </div>
    </div>
  );
}
