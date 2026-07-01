import type { DesktopBridge } from "@repo/core/ipc";

/** Access the preload-injected bridge from the renderer process. */
export function getBridge(): DesktopBridge | null {
  return window.desktopBridge ?? null;
}
