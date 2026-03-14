import type { DesktopBridge } from "../shared/ipc";

/** Access the preload-injected bridge from the renderer process. */
export function getBridge(): DesktopBridge | null {
  return (window as unknown as { desktopBridge?: DesktopBridge }).desktopBridge ?? null;
}
