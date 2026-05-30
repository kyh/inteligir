import { randomUUID } from "node:crypto";
import { BrowserWindow, ipcMain } from "electron";

import { IPC_CHANNELS } from "@/shared/ipc";

// Asks any renderer mounting the widget to flush its pending debounced state
// to main, and resolves when the renderer acknowledges (or `timeoutMs`
// elapses). Used by main-side actions like the agent's `manage_ui unplace`
// that need an up-to-date snapshot before archiving or destroying an
// instance's state. Falls back to no-op when no renderer is alive.
export async function flushRendererInstance(
  instanceId: string,
  timeoutMs = 500,
): Promise<void> {
  const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  if (wins.length === 0) return;
  const requestId = randomUUID();
  await new Promise<void>((resolve) => {
    const handler = (_e: Electron.IpcMainEvent, payload: unknown): void => {
      if (
        typeof payload === "object" &&
        payload !== null &&
        (payload as { requestId?: unknown }).requestId === requestId
      ) {
        cleanup();
        resolve();
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
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
