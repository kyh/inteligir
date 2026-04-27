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

  constructor(storePath?: string) {
    this.store = new JsonStore(
      storePath ?? inteligirPath("notifications.json"),
      NotificationSettingsSchema,
      DEFAULT_SETTINGS,
    );
  }

  getSettings(): NotificationSettings {
    return this.store.read();
  }

  updateSettings(patch: Partial<NotificationSettings>): NotificationSettings {
    return this.store.update((current) => ({ ...current, ...patch }));
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
      const win = BrowserWindow.getAllWindows()[0];
      if (!win || win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    });

    notification.show();
  }

  private anyWindowFocused(): boolean {
    return BrowserWindow.getAllWindows().some(
      (w) => !w.isDestroyed() && w.isFocused(),
    );
  }
}

let _instance: NotificationsManager | null = null;

export function getNotifications(): NotificationsManager {
  if (!_instance) _instance = new NotificationsManager();
  return _instance;
}
