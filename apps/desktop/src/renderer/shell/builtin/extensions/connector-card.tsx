import { CheckIcon, Loader2Icon } from "lucide-react";

import { Button } from "@repo/ui/components/button";

import type { CatalogConnector } from "@/renderer/shell/builtin/extensions/connector-catalog";

type ConnectorStatus = "idle" | "connecting" | "connected" | "disconnecting";

type ConnectorCardProps = {
  connector: CatalogConnector;
  status: ConnectorStatus;
  onConnect: () => void;
  onDisconnect: () => void;
};

/** Monogram tile standing in for a brand logo (keeps the catalog dependency-free). */
function Monogram({ name, accent }: { name: string; accent: string }) {
  return (
    <div
      className="flex size-8 shrink-0 items-center justify-center rounded-md text-xs font-semibold text-white"
      style={{ backgroundColor: accent }}
      aria-hidden
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

export function ConnectorCard({ connector, status, onConnect, onDisconnect }: ConnectorCardProps) {
  const connecting = status === "connecting";
  const disconnecting = status === "disconnecting";
  // The "connected" layout also covers an in-progress disconnect, so the card
  // doesn't fall back to a misleading "Connect" button mid-operation.
  const showConnected = status === "connected" || disconnecting;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-background/40 p-3">
      <div className="flex items-start gap-2.5">
        <Monogram name={connector.name} accent={connector.accent} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-xs font-medium text-foreground">{connector.name}</span>
          <span className="line-clamp-2 text-[10px] leading-tight text-muted-foreground">
            {connector.description}
          </span>
        </div>
      </div>
      {showConnected ? (
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
            <CheckIcon className="size-3" />
            Connected
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDisconnect}
            disabled={disconnecting}
            className="h-6 px-2 text-[10px] text-muted-foreground hover:text-destructive"
          >
            {disconnecting ? (
              <span className="flex items-center gap-1.5">
                <Loader2Icon className="size-3 animate-spin" />
                Disconnecting…
              </span>
            ) : (
              "Disconnect"
            )}
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={onConnect}
          disabled={connecting}
          className="h-7 w-full text-[10px]"
        >
          {connecting ? (
            <span className="flex items-center gap-1.5">
              <Loader2Icon className="size-3 animate-spin" />
              Connecting…
            </span>
          ) : (
            "Connect"
          )}
        </Button>
      )}
    </div>
  );
}
