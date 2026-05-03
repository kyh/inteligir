import { BrowserWindow } from "electron";

/**
 * Send `data` on `channel` to every renderer window. Skips destroyed
 * windows. Safe to call before any window exists.
 */
export function broadcastToRenderer(channel: string, data: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, data);
    }
  }
}
