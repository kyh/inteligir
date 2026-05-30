import { randomUUID } from "node:crypto";
import { BrowserWindow, ipcMain } from "electron";

import { IPC_CHANNELS } from "@/shared/ipc";

// Asks every alive renderer window to flush its pending debounced state for
// the given instance to main, and resolves with whether all targeted windows
// acknowledged in time. Used by main-side actions like the agent's
// `manage_ui unplace` that need an up-to-date snapshot before archiving or
// destroying an instance's state.
//
// Per-window tracking is important: any extra window (e.g. DevTools, a popup
// without the viewer mounted) acks immediately because its flushInstanceState
// is a no-op. Treating the first ack as success would let main proceed with
// stale state while the real viewer was still flushing. Instead we wait for
// every webContents we sent to.
//
// Returns `true` on full ack (or when no renderer is alive — nothing to
// flush), `false` on timeout. The 2000ms default is generous relative to a
// healthy flush IPC round-trip (~milliseconds); when it does fire, a renderer
// is stuck or genuinely unreachable and the caller proceeds with potentially
// stale state.
export async function flushRendererInstance(
  instanceId: string,
  timeoutMs = 2000,
): Promise<boolean> {
  const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  if (wins.length === 0) return true;
  const requestId = randomUUID();
  const pendingWebContentsIds = new Set(wins.map((w) => w.webContents.id));
  return new Promise<boolean>((resolve) => {
    const handler = (e: Electron.IpcMainEvent, payload: unknown): void => {
      if (!isFlushAck(payload, requestId)) return;
      pendingWebContentsIds.delete(e.sender.id);
      if (pendingWebContentsIds.size === 0) {
        cleanup();
        resolve(true);
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);
    const cleanup = (): void => {
      clearTimeout(timer);
      ipcMain.removeListener(IPC_CHANNELS.SHELL_FLUSH_ACK, handler);
    };
    ipcMain.on(IPC_CHANNELS.SHELL_FLUSH_ACK, handler);
    for (const w of wins) {
      w.webContents.send(IPC_CHANNELS.SHELL_FLUSH_REQUEST, { instanceId, requestId });
    }
  });
}

function isFlushAck(payload: unknown, requestId: string): payload is { requestId: string } {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "requestId" in payload &&
    payload.requestId === requestId
  );
}
