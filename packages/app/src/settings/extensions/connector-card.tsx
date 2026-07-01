import { CheckIcon, Loader2Icon } from "lucide-react";

import { Button } from "@repo/ui/components/button";

import type { CatalogConnector } from "@repo/app/settings/extensions/connector-catalog";
import { CONNECTOR_ICON_PATHS } from "@repo/app/settings/extensions/connector-icons";

type ConnectorStatus = "idle" | "connecting" | "connected" | "disconnecting";

type ConnectorCardProps = {
  connector: CatalogConnector;
  status: ConnectorStatus;
  /** Signed-in identity from the live connection (null when not provided). */
  identityLabel: string | null;
  /** Whether the connected integration may be removed (executor's canRemove). */
  canDisconnect: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
};

/** The connector's brand glyph on its accent tile, falling back to a monogram. */
function BrandTile({ connector }: { connector: CatalogConnector }) {
  const iconPath = CONNECTOR_ICON_PATHS[connector.id];
  return (
    <div
      className="flex size-8 shrink-0 items-center justify-center rounded-md text-xs font-semibold text-white"
      style={{ backgroundColor: connector.accent }}
      aria-hidden
    >
      {iconPath ? (
        <svg viewBox="0 0 24 24" className="size-4" fill="#fff">
          <path d={iconPath} />
        </svg>
      ) : (
        connector.name.charAt(0).toUpperCase()
      )}
    </div>
  );
}

export function ConnectorCard({
  connector,
  status,
  identityLabel,
  canDisconnect,
  onConnect,
  onDisconnect,
}: ConnectorCardProps) {
  const connecting = status === "connecting";
  const disconnecting = status === "disconnecting";
  // The "connected" layout also covers an in-progress disconnect, so the card
  // doesn't fall back to a misleading "Connect" button mid-operation.
  // "Connected" only ever renders when a live, credentialed connection exists
  // (the section derives status from executor's connections, not integrations).
  const showConnected = status === "connected" || disconnecting;

  return (
    <div className="flex flex-col gap-2 rounded-[12px] bg-muted p-3">
      <div className="flex items-start gap-2.5">
        <BrandTile connector={connector} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-xs font-medium text-foreground">{connector.name}</span>
          <span className="line-clamp-2 text-[10px] leading-tight text-muted-foreground">
            {connector.description}
          </span>
        </div>
      </div>
      {showConnected ? (
        <div className="flex items-center justify-between gap-2">
          <span
            className="flex min-w-0 items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
            title={identityLabel ?? undefined}
          >
            <CheckIcon className="size-3 shrink-0" />
            <span className="truncate">{identityLabel ?? "Connected"}</span>
          </span>
          {canDisconnect && (
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
          )}
        </div>
      ) : (
        <Button
          variant="tertiary"
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
