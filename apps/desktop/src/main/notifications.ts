// ---------------------------------------------------------------------------
// OS-level notifications when the agent finishes a turn while the window is
// unfocused. Uses Electron's built-in Notification API — no extra binary.
// ---------------------------------------------------------------------------

import { z } from "zod";
import { BrowserWindow, Notification } from "electron";

import { JsonStore, inteligirPath } from "@/main/lib/json-store";

const NotificationSettingsSchema = z.object({
  enabled: z.boolean(),
});

export type NotificationSettings = z.infer<typeof NotificationSettingsSchema>;

const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: true,
};

export class NotificationsManager {
  private readonly store: JsonStore<NotificationSettings>;
  /**
   * The window the click handler should focus. Registered explicitly so we
   * don't rely on BrowserWindow.getAllWindows()[0], whose ordering Electron
   * does not guarantee — auxiliary windows (devtools, about panels) could
   * otherwise be targeted instead of the main app window.
   */
  private targetWindow: BrowserWindow | null = null;

  constructor(storePath?: string) {
    this.store = new JsonStore(
      storePath ?? inteligirPath("notifications.json"),
      NotificationSettingsSchema,
      DEFAULT_SETTINGS,
    );
  }

  setTargetWindow(window: BrowserWindow): void {
    this.targetWindow = window;
    window.on("closed", () => {
      if (this.targetWindow === window) this.targetWindow = null;
    });
  }

  getSettings(): NotificationSettings {
    return this.store.read();
  }

  /**
   * Drop the cached settings so the next `getSettings()` re-reads from disk.
   * Used after teardownResources() deletes ~/.inteligir/notifications.json so
   * we don't keep serving the pre-teardown cache.
   */
  invalidate(): void {
    this.store.invalidate();
  }

  updateSettings(patch: Partial<NotificationSettings>): NotificationSettings {
    // Don't blindly spread the patch — Zod input allows `enabled: undefined`,
    // which would overwrite the live setting and round-trip through the
    // schema's default on next read, silently resetting the user's choice.
    return this.store.update((current) => ({
      ...current,
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    }));
  }

  /**
   * Notify the user that the agent finished a turn. No-ops if disabled,
   * if any window has focus, or if the OS doesn't support notifications.
   *
   * `body` is truncated to a reasonable preview length — the agent's full
   * output is already visible inside the app.
   */
  notifyAgentIdle(body: string | undefined): void {
    if (!this.getSettings().enabled) return;
    if (!Notification.isSupported()) return;
    if (this.anyWindowFocused()) return;

    const preview = body?.trim().slice(0, 180) ?? "Agent finished.";
    const notification = new Notification({
      title: "Inteligir",
      body: preview.length > 0 ? preview : "Agent finished.",
      silent: false,
    });

    notification.on("click", () => {
      const win = this.targetWindow;
      if (!win || win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    });

    notification.show();
  }

  private anyWindowFocused(): boolean {
    // Fast-path the common "main window is focused → suppress" case before
    // scanning every window. The scan still runs when the main window is
    // unfocused, since auxiliary windows (devtools, etc) also count as
    // "the app is in the foreground" from the user's POV.
    const target = this.targetWindow;
    if (target && !target.isDestroyed() && target.isFocused()) return true;
    return BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isFocused());
  }
}

let _instance: NotificationsManager | null = null;

export function getNotifications(): NotificationsManager {
  if (!_instance) _instance = new NotificationsManager();
  return _instance;
}

/**
 * Invalidate the singleton's JsonStore cache. Called from teardownResources()
 * so the next read goes back to disk after AGENT_DIR is wiped. Note: we
 * deliberately do NOT null the singleton — that would also drop the target
 * window registration set up at app startup, leaving notification clicks as
 * silent no-ops after a logout/re-login cycle.
 */
export function resetNotifications(): void {
  _instance?.invalidate();
}
