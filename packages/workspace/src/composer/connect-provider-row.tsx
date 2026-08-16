import { useCallback } from "react";
import { SparklesIcon } from "lucide-react";

import { Button } from "@repo/ui/components/button";

import { useAiProviderStore } from "@repo/editor/stores/ai-provider-store";

const IDLE_HINT = "Chat and editor AI are off until one is connected — Settings → AI to switch.";

/**
 * The composer's guest-mode surface: shown in place of the chat input when no
 * AI provider is connected. AI is a FEATURE gate, never an app gate — the
 * workspace stays fully usable; this row just offers the way in.
 *
 * Connect runs the shared ai-provider-store flow for the SELECTED provider (the
 * same one Settings → AI drives), so the consent tab, the waiting state and the
 * completed connect are one implementation rather than this row's copy of one.
 */
export function ConnectProviderRow() {
  const settings = useAiProviderStore((s) => s.settings);
  const connect = useAiProviderStore((s) => s.connect);
  const startConnect = useAiProviderStore((s) => s.startConnect);
  const dismissConnect = useAiProviderStore((s) => s.dismissConnect);

  const selected = settings?.providers.find((p) => p.id === settings.selected.provider) ?? null;

  const handleConnect = useCallback(() => {
    if (selected) void startConnect(selected.id);
  }, [selected, startConnect]);

  return (
    <div className="flex h-12 items-center gap-2 pr-1.5 pl-3">
      <SparklesIcon className="size-4 shrink-0 text-muted-foreground/70" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm text-muted-foreground">Connect an AI provider</span>
        {connect.phase === "awaiting" ? (
          <a
            href={connect.authorizeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-[10px] text-muted-foreground/70 underline underline-offset-2 hover:text-foreground"
          >
            Waiting for the consent page — open it again if it didn&rsquo;t appear.
          </a>
        ) : (
          <span
            className="truncate text-[10px] text-muted-foreground/70"
            title={connect.phase === "failed" ? connect.error : undefined}
          >
            {connect.phase === "failed" ? connect.error : IDLE_HINT}
          </span>
        )}
      </span>
      {connect.phase === "awaiting" ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={dismissConnect}
          className="h-8 shrink-0 rounded-full px-3 text-xs"
        >
          Cancel
        </Button>
      ) : (
        <Button
          size="sm"
          onClick={handleConnect}
          disabled={connect.phase === "starting" || !selected}
          className="h-8 shrink-0 rounded-full px-3 text-xs"
        >
          {connect.phase === "starting"
            ? "Opening…"
            : connect.phase === "failed"
              ? "Try again"
              : selected
                ? `Connect ${selected.label}`
                : "Connect"}
        </Button>
      )}
    </div>
  );
}
