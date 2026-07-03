// ---------------------------------------------------------------------------
// Browser entry — the WS counterpart of the desktop preload: installs a
// WebSocket Bridge against the same origin that served this page
// (@repo/server), then renders the portable App plus a connection-lost
// overlay fed by the bridge's reconnect state.
// ---------------------------------------------------------------------------

import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";

import { App } from "@repo/app/app-root";
import { installBridge } from "@repo/app/lib/bridge";
import { createWsBridge, type WsBridgeConnectionState } from "@repo/features/bridge-ws-client";

let connectionState: WsBridgeConnectionState = "connecting";
const connectionListeners = new Set<() => void>();

function subscribeConnection(listener: () => void): () => void {
  connectionListeners.add(listener);
  return () => {
    connectionListeners.delete(listener);
  };
}

const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
installBridge(
  createWsBridge(`${wsProtocol}://${location.host}/bridge`, {
    onConnectionState: (state) => {
      connectionState = state;
      for (const listener of connectionListeners) listener();
    },
  }),
);

/** Shown only after the bridge has lost an established connection — the
 * bridge itself keeps retrying with backoff and resyncs on reopen. */
function ConnectionOverlay() {
  const state = useSyncExternalStore(subscribeConnection, () => connectionState);
  if (state !== "reconnecting") return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="flex items-center gap-3 rounded-xl border border-border bg-background px-5 py-3.5 text-sm font-medium text-foreground shadow-lg">
        <span className="size-2 animate-pulse rounded-full bg-red-500" />
        Connection lost — reconnecting…
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <>
      <App />
      <ConnectionOverlay />
    </>,
  );
}
