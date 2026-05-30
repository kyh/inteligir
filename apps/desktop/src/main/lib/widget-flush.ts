import { randomUUID } from "node:crypto";
import { BrowserWindow, ipcMain } from "electron";

import { IPC_CHANNELS } from "@/shared/ipc";

// Asks any renderer mounting the widget to flush its pending debounced state
// to main, and resolves with whether the renderer acknowledged in time. Used
// by main-side actions like the agent's `manage_ui unplace` that need an
// up-to-date snapshot before archiving or destroying an instance's state.
//
// Returns `true` on ack (or when no renderer is alive — nothing to flush),
// `false` on timeout. The 2000ms default is generous relative to a healthy
// flush IPC round-trip (~milliseconds); when it does fire, the renderer is
// either stuck or genuinely unreachable and we accept that the caller will
// proceed with potentially stale state.
export async function flushRendererInstance(
  instanceId: string,
  timeoutMs = 2000,
): Promise<boolean> {
  const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  if (wins.length === 0) return true;
  const requestId = randomUUID();
  return new Promise<boolean>((resolve) => {
    const handler = (_e: Electron.IpcMainEvent, payload: unknown): void => {
      if (
        typeof payload === "object" &&
        payload !== null &&
        (payload as { requestId?: unknown }).requestId === requestId
      ) {
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
