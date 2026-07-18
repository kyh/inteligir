import { useCallback, useState } from "react";
import { SparklesIcon } from "lucide-react";

import { Button } from "@repo/ui/components/button";

import { useAiProviderStore } from "@renderer/stores/ai-provider-store";

/**
 * The composer's guest-mode surface: shown in place of the chat input when no
 * AI provider is connected. AI is a FEATURE gate, never an app gate (#459) —
 * the workspace stays fully usable; this row just offers the way in. Connect
 * runs the existing `connectAiProvider` OAuth path for the SELECTED provider
 * (the same one Settings → AI drives) through the shared ai-provider-store,
 * so a completed connect flips this row back to the input immediately.
 */
export function ConnectProviderRow() {
  const settings = useAiProviderStore((s) => s.settings);
  const connect = useAiProviderStore((s) => s.connect);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = settings?.providers.find((p) => p.id === settings.selected.provider) ?? null;

  const handleConnect = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const result = await connect(selected.id);
      if (!result.ok) setError(result.error);
    } catch {
      setError("Failed to connect.");
    } finally {
      setBusy(false);
    }
  }, [selected, connect]);

  return (
    <div className="flex h-12 items-center gap-2 pr-1.5 pl-3">
      <SparklesIcon className="size-4 shrink-0 text-muted-foreground/70" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm text-muted-foreground">Connect an AI provider</span>
        <span className="truncate text-[10px] text-muted-foreground/70" title={error ?? undefined}>
          {error ?? "Chat and editor AI are off until one is connected — Settings → AI to switch."}
        </span>
      </span>
      <Button
        size="sm"
        onClick={() => void handleConnect()}
        disabled={busy || !selected}
        className="h-8 shrink-0 rounded-full px-3 text-xs"
      >
        {busy ? "Opening…" : selected ? `Connect ${selected.label}` : "Connect"}
      </Button>
    </div>
  );
}
